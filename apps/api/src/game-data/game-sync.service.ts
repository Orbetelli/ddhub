import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { SupabaseService } from '../supabase/supabase.service.js';
import { MemoryCache } from '../cache/memory-cache.service.js';
import { DeadlockApiClient } from './deadlock-api.client.js';
import { asList, mapHeroAbilities, mapHeroes, mapItems, mapNpcs, pickTopLevelIcons } from './game-mappers.js';
import type { ApiNpc } from './deadlock.types.js';

export interface SyncResult {
  runId: string;
  heroes: number;
  selectableHeroes: number;
  items: number;
  abilities: number;
  npcs: number;
  durationMs: number;
}

const CHUNK = 200; // upserts em lotes, para não estourar o tamanho da requisição

@Injectable()
export class GameSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GameSyncService.name);
  private running = false;

  constructor(
    private readonly api: DeadlockApiClient,
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
  ) {}

  /** Com SYNC_ON_BOOT=true, sincroniza ao subir a API (útil no primeiro uso). */
  onApplicationBootstrap(): void {
    if (process.env['SYNC_ON_BOOT'] === 'true') {
      void this.sync().catch((err) => this.logger.error(`Sync inicial falhou: ${String(err)}`));
    }
  }

  /** Todo dia às 5h (horário de Brasília). Patches novos entram no dia seguinte. */
  @Cron('0 5 * * *', { name: 'deadlock-sync', timeZone: 'America/Sao_Paulo' })
  async scheduledSync(): Promise<void> {
    try {
      await this.sync();
    } catch (err) {
      this.logger.error(`Sync agendado falhou: ${String(err)}`);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  async sync(): Promise<SyncResult> {
    if (this.running) throw new Error('Já existe uma sincronização em andamento.');
    this.running = true;
    const started = Date.now();
    const db = this.supabase.db;

    const { data: run, error: runErr } = await db.from('game_sync_runs').insert({}).select('id').single();
    if (runErr) {
      this.running = false;
      throw new Error(`Não consegui registrar a execução: ${runErr.message}`);
    }

    try {
      this.logger.log('Buscando heróis e itens na Deadlock API (PT-BR e EN)...');
      const [heroesPt, heroesEn, itemsPt, itemsEn] = await Promise.all([
        this.api.getHeroes('brazilian'),
        this.api.getHeroes('english'),
        this.api.getItems('brazilian'),
        this.api.getItems('english'),
      ]);

      // 1) Itens primeiro (hero_abilities e build_items apontam para eles)
      const items = mapItems(itemsPt, itemsEn);
      await this.upsertInChunks('items', items, 'id');

      // 2) Heróis
      const heroes = mapHeroes(heroesPt, heroesEn);
      await this.upsertInChunks('heroes', heroes, 'id');

      // 3) Habilidades de cada herói
      const itemIdByClass = new Map(items.map((i) => [i.class_name, i.id]));
      const abilities = mapHeroAbilities(heroesPt, itemIdByClass);
      await this.upsertInChunks('hero_abilities', abilities, 'hero_id,slot');

      // 4) NPCs, mapa e ícones (imagens do guia). Se falhar, não derruba o sync todo.
      const npcCount = await this.syncAssets().catch((err) => {
        this.logger.warn(`Assets (NPCs/mapa/ícones) não sincronizados: ${String(err)}`);
        return 0;
      });

      const result: SyncResult = {
        runId: run.id as string,
        heroes: heroes.length,
        selectableHeroes: heroes.filter((h) => h.is_selectable).length,
        items: items.length,
        abilities: abilities.length,
        npcs: npcCount,
        durationMs: Date.now() - started,
      };

      await db
        .from('game_sync_runs')
        .update({ status: 'success', finished_at: new Date().toISOString(), heroes_count: result.heroes, items_count: result.items })
        .eq('id', run.id);

      this.logger.log(
        `Sync ok: ${result.heroes} heróis (${result.selectableHeroes} jogáveis), ${result.items} itens, ${result.abilities} habilidades, ${result.npcs} NPCs em ${result.durationMs} ms`,
      );
      // Dados novos: descarta o que estava em cache
      this.cache.clear();
      return result;
    } catch (err) {
      await db
        .from('game_sync_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), error: String(err).slice(0, 2000) })
        .eq('id', run.id);
      throw err;
    } finally {
      this.running = false;
    }
  }

  /** NPCs + mapa + ícones. Devolve quantos NPCs foram gravados. */
  private async syncAssets(): Promise<number> {
    const [npcsPt, npcsEn, map, icons] = await Promise.all([
      this.api.getNpcUnits('brazilian'),
      this.api.getNpcUnits('english'),
      this.api.getMap(),
      this.api.getIcons(),
    ]);

    const npcs = mapNpcs(asList<ApiNpc>(npcsPt), asList<ApiNpc>(npcsEn));
    await this.upsertInChunks('npcs', npcs, 'id');

    const now = new Date().toISOString();
    const assets = [
      {
        key: 'map',
        data: {
          radius: map.radius ?? null,
          images: map.images ?? {},
          objective_positions: map.objective_positions ?? {},
          neutral_camps: map.neutral_camps ?? null,
        },
        synced_at: now,
      },
      { key: 'icons', data: pickTopLevelIcons(icons), synced_at: now },
    ];
    await this.upsertInChunks('game_assets', assets, 'key');

    return npcs.length;
  }

  private async upsertInChunks(table: string, rows: object[], onConflict: string): Promise<void> {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await this.supabase.db.from(table).upsert(chunk, { onConflict });
      if (error) throw new Error(`Erro ao gravar ${table} (lote ${i / CHUNK + 1}): ${error.message}`);
    }
  }
}