import { Controller, Get, InternalServerErrorException, Query } from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service.js';
import { MemoryCache, TTL } from '../cache/memory-cache.service.js';

export type MarkerKind =
  | 'guardiao'
  | 'andador'
  | 'guardiao-base'
  | 'santuario'
  | 'patrono'
  | 'chefe-meio'
  | 'base'
  | 'acampamento'
  | 'outro';

export interface MapMarker {
  id: string;
  kind: MarkerKind;
  /** 0 = The Hidden King, 1 = The Archmother, null = neutro */
  team: 0 | 1 | null;
  /** Para acampamentos: tamanho conforme o "kind" do jogo. */
  size: 'pequeno' | 'medio' | 'grande' | 'cofre' | null;
  /** Lane do objetivo (1, 3 ou 4 nos dados do jogo). */
  lane: number | null;
  /** Ícone oficial do minimapa (acampamentos). */
  icon: string | null;
  /** Posição em fração da imagem do mapa (0 a 1). */
  x: number;
  y: number;
  /** Chave original nos dados do jogo (útil para conferir). */
  source: string;
}

export interface MapView {
  key: string;
  label: string;
  url: string;
}

export interface MapData {
  image: string | null;
  /** Outras imagens do mapa (túneis), sem marcadores. */
  views: MapView[];
  markers: MapMarker[];
}

type Row = Record<string, any>;

/**
 * Mapa interativo: imagem do minimapa + marcadores de objetivos e acampamentos.
 * Os dados vêm de game_assets.map (sync diário da Deadlock API).
 *
 * GET /map?debug=1 devolve um resumo da estrutura crua, para conferir nomes de chaves.
 */
@Controller('map')
export class MapController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
  ) {}

  @Get()
  async get(@Query('debug') debug?: string) {
    if (debug === '1') return this.describe(await this.loadRaw());
    // Cache antes de ir ao banco
    return this.cache.get('map', TTL.game, async () => this.build(await this.loadRaw()));
  }

  private async loadRaw(): Promise<Row> {
    const { data, error } = await this.supabase.db.from('game_assets').select('data').eq('key', 'map').maybeSingle();
    if (error) throw new InternalServerErrorException('Não foi possível carregar o mapa.');
    return (data?.data ?? {}) as Row;
  }

  private build(raw: Row): MapData {
    const images = (raw['images'] ?? {}) as Record<string, string>;
    const radius = typeof raw['radius'] === 'number' && raw['radius'] > 0 ? (raw['radius'] as number) : null;
    const markers: MapMarker[] = [];

    // ── objetivos: { "team0_tier1_1": { left_relative, top_relative }, ... }
    for (const [key, pos] of Object.entries((raw['objective_positions'] ?? {}) as Record<string, Row>)) {
      const point = relPoint(pos);
      if (!point) continue;
      const lane = key.match(/tier\d_(\d)/)?.[1];
      markers.push({
        id: key,
        kind: classifyObjective(key),
        team: teamOf(key),
        size: null,
        lane: lane ? Number(lane) : null,
        icon: null,
        ...point,
        source: key,
      });
    }

    // ── acampamentos: formato livre; procura pontos em qualquer nível
    walk(raw['neutral_camps'], 'neutral_camps', (path, node) => {
      const point = relPoint(node) ?? worldPoint(node, radius);
      if (!point) return false;
      const n = node as Row;
      // Formato atual: { kind: "vault", name: "chinatown_bell_1", icon: "...png", position, left_relative, top_relative }
      const text = `${n['kind'] ?? ''} ${n['icon'] ?? ''} ${path}`.toLowerCase();
      markers.push({
        id: typeof n['name'] === 'string' ? `camp-${n['name']}` : `camp-${markers.length}`,
        kind: 'acampamento',
        team: null,
        size: campSize(text),
        lane: null,
        icon: typeof n['icon'] === 'string' ? n['icon'] : null,
        ...point,
        source: typeof n['name'] === 'string' ? n['name'] : path,
      });
      return true; // não desce mais nesse nó
    });

    const views: MapView[] = [];
    if (images['mid_tunnels']) views.push({ key: 'mid_tunnels', label: 'Túneis do meio', url: images['mid_tunnels'] });
    if (images['rat_tunnels']) views.push({ key: 'rat_tunnels', label: 'Túneis dos ratos', url: images['rat_tunnels'] });

    return {
      image: images['minimap'] ?? images['plain'] ?? firstImage(images, /minimap/) ?? null,
      views,
      markers: markers.filter((m) => m.x >= 0 && m.x <= 1 && m.y >= 0 && m.y <= 1),
    };
  }

  /** Resumo da estrutura crua (sem despejar tudo): chaves e exemplos. */
  private describe(raw: Row) {
    const sample = (v: unknown, depth = 0): unknown => {
      if (Array.isArray(v)) return { array: v.length, first: depth < 3 ? sample(v[0], depth + 1) : '…' };
      if (v && typeof v === 'object') {
        const entries = Object.entries(v as Row);
        const out: Row = { _keys: entries.length };
        for (const [k, val] of entries.slice(0, 6)) out[k] = depth < 3 ? sample(val, depth + 1) : '…';
        return out;
      }
      return v;
    };
    return {
      top_level: Object.keys(raw),
      radius: raw['radius'] ?? null,
      images: raw['images'] ?? {},
      objective_keys: Object.keys(raw['objective_positions'] ?? {}),
      neutral_camps: sample(raw['neutral_camps']),
      camp_kinds: [...new Set((Array.isArray(raw['neutral_camps']) ? raw['neutral_camps'] : []).map((c: Row) => c?.['kind']))],
      markers_found: this.build(raw).markers.length,
    };
  }
}

// ───────────────────────── helpers ─────────────────────────

function relPoint(node: unknown): { x: number; y: number } | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as Row;
  let x = Number(n['left_relative']);
  let y = Number(n['top_relative']);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  // Alguns dados vêm em porcentagem (0–100)
  if (x > 1.5 || y > 1.5) {
    x /= 100;
    y /= 100;
  }
  return { x, y };
}

/** Coordenada do mundo (centro em 0,0) → fração da imagem, usando o raio do mapa. */
function worldPoint(node: unknown, radius: number | null): { x: number; y: number } | null {
  if (!radius || !node || typeof node !== 'object') return null;
  const n = node as Row;
  const pos = Array.isArray(n['position']) ? n['position'] : Array.isArray(n['pos']) ? n['pos'] : null;
  const wx = Number(pos ? pos[0] : n['x']);
  const wy = Number(pos ? pos[1] : n['y']);
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null;
  return { x: (wx + radius) / (2 * radius), y: (radius - wy) / (2 * radius) };
}

function walk(node: unknown, path: string, visit: (path: string, node: unknown) => boolean, depth = 0): void {
  if (depth > 6 || node === null || node === undefined) return;
  if (typeof node === 'object' && visit(path, node)) return;
  if (Array.isArray(node)) node.forEach((child, i) => walk(child, `${path}[${i}]`, visit, depth + 1));
  else if (typeof node === 'object') {
    for (const [k, child] of Object.entries(node as Row)) walk(child, `${path}.${k}`, visit, depth + 1);
  }
}

function classifyObjective(key: string): MarkerKind {
  const k = key.toLowerCase();
  if (/shield|shrine|generator/.test(k)) return 'santuario';
  if (/titan|patron/.test(k)) return 'patrono';
  if (/core/.test(k)) return 'base';
  if (/mid_?boss/.test(k)) return 'chefe-meio';
  if (/barrack|base_guard|tier3/.test(k)) return 'guardiao-base';
  if (/tier2|walker/.test(k)) return 'andador';
  if (/tier1|guardian/.test(k)) return 'guardiao';
  return 'outro';
}

function teamOf(key: string): 0 | 1 | null {
  const k = key.toLowerCase();
  if (/team_?0|amber|hidden_?king/.test(k)) return 0;
  if (/team_?1|sapphire|archmother/.test(k)) return 1;
  return null;
}

function campSize(text: string): MapMarker['size'] {
  if (/vault/.test(text)) return 'cofre';
  if (/small|easy|weak/.test(text)) return 'pequeno';
  if (/medium|normal/.test(text)) return 'medio';
  if (/large|hard|strong/.test(text)) return 'grande';
  return null;
}

function firstImage(images: Record<string, string>, re: RegExp): string | undefined {
  return Object.entries(images).find(([k]) => re.test(k))?.[1];
}
