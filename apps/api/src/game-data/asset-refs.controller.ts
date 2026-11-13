import { Controller, Get, InternalServerErrorException } from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service.js';
import { MemoryCache, TTL } from '../cache/memory-cache.service.js';

export interface RefEntry {
  name: string;
  name_en: string | null;
  image: string | null;
}

export interface ImageRef {
  url: string;
  alt: string;
}

export interface AssetRefs {
  heroes: Record<string, RefEntry>;
  items: Record<string, RefEntry & { slot: string | null }>;
  npcs: Record<string, RefEntry>;
  images: Record<string, ImageRef>;
  /** Ícones do jogo por nome de arquivo ("neutral_small.png" → URL) para {{icone:...}} */
  icons: Record<string, string>;
  /** Habilidades por "heroi:slot" ("seven:1" → Bola de Raios) para {{habilidade:seven:1}} */
  abilities: Record<string, RefEntry>;
}

/**
 * Dicionário usado pelos atalhos do guia em Markdown:
 *   {{heroi:seven}}  {{item:clip-size}}  {{npc:plant-strong}}  {{imagem:mapa}}  {{icone:neutral_small.png}}
 *   {{habilidade:seven:1}}  (slot 1 a 4; o 4 é a ultimate)
 * Os dados vêm do banco (atualizado pelo sync), então se a Deadlock API mudar
 * de endereço, os textos do guia não quebram.
 */
@Controller('assets')
export class AssetRefsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
  ) {}

  @Get('refs')
  refs(): Promise<AssetRefs> {
    return this.cache.get('asset-refs', TTL.game, () => this.load());
  }

  private async load(): Promise<AssetRefs> {

    const db = this.supabase.db;
    const [heroes, shopItems, abilities, npcs, assets] = await Promise.all([
      db.from('hero_cards').select('slug, name, name_en, small_image'),
      db.from('items').select('slug, name, name_en, image_url, shop_image_url, slot').eq('shopable', true),
      db.from('hero_abilities').select('slot, heroes ( slug ), items ( slug, name, name_en, image_url )'),
      db.from('npcs').select('slug, class_name, name, name_en, image_url'),
      db.from('game_assets').select('key, data'),
    ]);

    const failed = [heroes, shopItems, abilities, npcs, assets].find((r) => r.error);
    if (failed) throw new InternalServerErrorException('Não foi possível carregar as referências.');

    type Row = Record<string, any>;
    const out: AssetRefs = { heroes: {}, items: {}, npcs: {}, images: {}, icons: {}, abilities: {} };

    for (const h of (heroes.data ?? []) as Row[]) {
      out.heroes[h['slug']] = { name: h['name'], name_en: h['name_en'], image: h['small_image'] };
    }
    for (const i of (shopItems.data ?? []) as Row[]) {
      out.items[i['slug']] = {
        name: i['name'],
        name_en: i['name_en'],
        image: i['image_url'] ?? i['shop_image_url'],
        slot: i['slot'],
      };
    }
    for (const a of (abilities.data ?? []) as Row[]) {
      const it = a['items'] as Row | null;
      const hero = a['heroes'] as Row | null;
      if (!it) continue;
      const entry = { name: it['name'] ?? it['name_en'] ?? it['slug'], name_en: it['name_en'], image: it['image_url'] };
      if (!out.items[it['slug']]) out.items[it['slug']] = { ...entry, slot: null };
      if (hero?.['slug']) out.abilities[`${hero['slug']}:${a['slot']}`] = entry;
    }

    const npcByClass = new Map<string, Row>();
    for (const n of (npcs.data ?? []) as Row[]) {
      npcByClass.set(n['class_name'], n);
      out.npcs[n['slug']] = { name: n['name'] ?? n['name_en'] ?? n['slug'], name_en: n['name_en'], image: n['image_url'] };
    }

    // Imagens soltas com nome amigável para o guia
    const asset = (key: string) => ((assets.data ?? []) as Row[]).find((a) => a['key'] === key)?.['data'] ?? {};
    const map = asset('map') as Row;
    const icons = asset('icons') as Record<string, string>;
    const add = (key: string, url: string | null | undefined, alt: string) => {
      if (url) out.images[key] = { url, alt };
    };

    add('mapa', map['images']?.['minimap'], 'Mapa de Deadlock');
    add('mapa-tuneis', map['images']?.['mid_tunnels'], 'Mapa com os túneis do meio');
    add('patrono-hidden-king', npcByClass.get('npc_boss_tier3')?.['image_url'], 'The Hidden King');
    add('patrono-archmother', npcByClass.get('alt_npc_boss_tier3')?.['image_url'], 'The Archmother');
    add('acampamento-pequeno', icons['neutral_small.png'], 'Ícone de acampamento pequeno');
    add('acampamento-medio', icons['neutral_medium.png'], 'Ícone de acampamento médio');
    add('acampamento-grande', icons['neutral_large.png'], 'Ícone de acampamento grande');
    add('caixa-dourada', icons['gold_crate_marker.png'], 'Ícone de caixa dourada');

    out.icons = icons;
    return out;
  }
}