import { BadRequestException, Controller, Get, InternalServerErrorException, NotFoundException, Param, Query } from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service.js';
import { MemoryCache, TTL } from '../cache/memory-cache.service.js';

const SLUG = /^[a-z0-9-]{1,60}$/;

const TEAM_FIELDS = 'slug, name, tag, region, country, logo_url, founded_at, is_active';
const PLAYER_FIELDS = 'slug, nickname, real_name, country, photo_url';

type Row = Record<string, any>;

export interface TeamCard {
  slug: string;
  name: string;
  tag: string | null;
  region: string;
  country: string | null;
  logo_url: string | null;
  founded_at: string | null;
  is_active: boolean;
  roster_count: number;
}

export interface TransferEvent {
  kind: 'join' | 'leave';
  date: string;
  role: string | null;
  player: Row;
  team: Row;
}

/**
 * Cena competitiva: times, jogadores e transferências.
 * Os dados vêm de content/cena/*.md (npm run content:sync).
 */
@Controller()
export class SceneController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
  ) {}

  @Get('teams')
  teams(): Promise<TeamCard[]> {
    return this.cache.get('teams', TTL.content, async () => {
      const [teams, current] = await Promise.all([
        this.supabase.db.from('teams').select(TEAM_FIELDS),
        this.supabase.db.from('player_team_history').select('team_id, teams(slug)').is('left_at', null),
      ]);
      if (teams.error || current.error) throw new InternalServerErrorException('Não foi possível carregar os times.');
      const count = new Map<string, number>();
      for (const r of (current.data ?? []) as Row[]) {
        const slug = r['teams']?.['slug'];
        if (slug) count.set(slug, (count.get(slug) ?? 0) + 1);
      }
      return ((teams.data ?? []) as Row[])
        .map((t) => ({ ...t, roster_count: count.get(t['slug']) ?? 0 }) as TeamCard)
        .sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name, 'pt-BR'));
    });
  }

  @Get('teams/:slug')
  team(@Param('slug') slug: string) {
    if (!SLUG.test(slug)) throw new BadRequestException('Endereço inválido.');
    return this.cache.get(`team:${slug}`, TTL.content, async () => {
      const { data: team, error } = await this.supabase.db
        .from('teams')
        .select(`id, ${TEAM_FIELDS}, bio_md, twitch, youtube, x_handle, discord_url`)
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw new InternalServerErrorException('Não foi possível carregar o time.');
      if (!team) throw new NotFoundException('Time não encontrado.');

      const { data: history, error: hErr } = await this.supabase.db
        .from('player_team_history')
        .select(`role, joined_at, left_at, players(${PLAYER_FIELDS})`)
        .eq('team_id', team.id)
        .order('joined_at', { ascending: true });
      if (hErr) throw new InternalServerErrorException('Não foi possível carregar o elenco.');

      const rows = ((history ?? []) as Row[]).filter((h) => h['players']);
      const member = (h: Row) => ({ ...h['players'], role: h['role'], joined_at: h['joined_at'], left_at: h['left_at'] });
      const { id: _id, ...rest } = team as Row;
      return {
        ...rest,
        roster: rows.filter((h) => !h['left_at']).map(member).sort(byRole),
        former: rows
          .filter((h) => h['left_at'])
          .map(member)
          .sort((a, b) => String(b.left_at).localeCompare(String(a.left_at))),
      };
    });
  }

  @Get('players/:slug')
  player(@Param('slug') slug: string) {
    if (!SLUG.test(slug)) throw new BadRequestException('Endereço inválido.');
    return this.cache.get(`player:${slug}`, TTL.content, async () => {
      const { data: player, error } = await this.supabase.db
        .from('players')
        .select(`id, ${PLAYER_FIELDS}, bio_md, twitch, youtube, x_handle`)
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw new InternalServerErrorException('Não foi possível carregar o jogador.');
      if (!player) throw new NotFoundException('Jogador não encontrado.');

      const { data: history, error: hErr } = await this.supabase.db
        .from('player_team_history')
        .select('role, joined_at, left_at, teams(slug, name, tag, logo_url)')
        .eq('player_id', player.id)
        .order('joined_at', { ascending: false });
      if (hErr) throw new InternalServerErrorException('Não foi possível carregar o histórico.');

      const teams = ((history ?? []) as Row[])
        .filter((h) => h['teams'])
        .map((h) => ({ ...h['teams'], role: h['role'], joined_at: h['joined_at'], left_at: h['left_at'] }));
      const { id: _id, ...rest } = player as Row;
      return { ...rest, current_team: teams.find((t) => !t.left_at) ?? null, teams };
    });
  }

  /** Entradas e saídas de jogadores, mais recentes primeiro. */
  @Get('transfers')
  async transfers(@Query('limit') limit?: string): Promise<TransferEvent[]> {
    const max = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const all = await this.cache.get('transfers', TTL.content, async () => {
      const { data, error } = await this.supabase.db
        .from('player_team_history')
        .select(`role, joined_at, left_at, players(${PLAYER_FIELDS}), teams(slug, name, tag, logo_url)`);
      if (error) throw new InternalServerErrorException('Não foi possível carregar as transferências.');
      const events: TransferEvent[] = [];
      for (const h of (data ?? []) as Row[]) {
        if (!h['players'] || !h['teams']) continue;
        const base = { role: h['role'], player: h['players'], team: h['teams'] };
        events.push({ kind: 'join', date: h['joined_at'], ...base });
        if (h['left_at']) events.push({ kind: 'leave', date: h['left_at'], ...base });
      }
      // Mesma data: saída antes da entrada (fica "saiu de X → entrou em Y")
      return events.sort((a, b) => b.date.localeCompare(a.date) || (a.kind === 'join' ? -1 : 1));
    });
    return all.slice(0, max);
  }
}

/** Ordem do elenco: jogadores, reservas, depois comissão técnica. */
function byRole(a: Row, b: Row): number {
  const order = (r: string) => (r === 'jogador' ? 0 : r === 'reserva' ? 1 : r === 'capitão' || r === 'capitao' ? 0 : 2);
  return order(a['role']) - order(b['role']) || String(a['nickname']).localeCompare(String(b['nickname']), 'pt-BR');
}