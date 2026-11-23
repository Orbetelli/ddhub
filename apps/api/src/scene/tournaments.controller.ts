import { BadRequestException, Controller, Get, InternalServerErrorException, NotFoundException, Param, Query } from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service.js';
import { MemoryCache, TTL } from '../cache/memory-cache.service.js';

const SLUG = /^[a-z0-9-]{1,60}$/;
const TEAM = 'slug, name, tag, logo_url';

type Row = Record<string, any>;

export interface MatchSide {
  /** null = time sem cadastro (seleção, time de fora): só o nome */
  slug: string | null;
  name: string;
  tag: string | null;
  logo_url: string | null;
}

export interface MatchCard {
  id: string;
  tournament: { slug: string; name: string } | null;
  stage: string | null;
  best_of: number;
  scheduled_at: string;
  status: 'scheduled' | 'live' | 'finished' | 'canceled';
  team1: MatchSide;
  team2: MatchSide;
  score1: number;
  score2: number;
  /** 1 ou 2 quando terminada */
  winner: 1 | 2 | null;
  stream_url: string | null;
}

export type TournamentStatus = 'upcoming' | 'ongoing' | 'finished';

export interface TournamentCard {
  slug: string;
  name: string;
  organizer: string | null;
  tier: string | null;
  region: string | null;
  prize_pool_usd: number | null;
  teams_count: number | null;
  starts_at: string | null;
  ends_at: string | null;
  logo_url: string | null;
  status: TournamentStatus;
  winner: MatchSide | null;
  matches_count: number;
}

const TOURNAMENT_FIELDS =
  'id, slug, name, organizer, tier, region, prize_pool_usd, teams_count, starts_at, ends_at, logo_url, external_url, startgg_slug, bio_md';

/**
 * Torneios e partidas da cena (content/cena/torneios/*.md e, se configurado, start.gg).
 * GET /tournaments · GET /tournaments/:slug · GET /matches?status=&team=&limit=
 */
@Controller()
export class TournamentsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
  ) {}

  @Get('tournaments')
  async tournaments(): Promise<TournamentCard[]> {
    return this.cache.get('tournaments', TTL.content, async () => {
      const [{ data: list, error }, matches, { data: winners, error: wErr }] = await Promise.all([
        this.supabase.db.from('tournaments').select(TOURNAMENT_FIELDS),
        this.allMatches(),
        this.supabase.db.from('tournament_placements').select(`tournament_id, team_name, teams(${TEAM})`).eq('position', 1),
      ]);
      if (error || wErr) throw new InternalServerErrorException('Não foi possível carregar os torneios.');

      const winnerOf = new Map(((winners ?? []) as Row[]).map((w) => [w['tournament_id'], side(w['teams'], w['team_name'])]));
      const countOf = new Map<string, number>();
      for (const m of matches) if (m.tournament) countOf.set(m.tournament.slug, (countOf.get(m.tournament.slug) ?? 0) + 1);

      return ((list ?? []) as Row[])
        .map((t): TournamentCard => ({
          slug: t['slug'],
          name: t['name'],
          organizer: t['organizer'],
          tier: t['tier'],
          region: t['region'],
          prize_pool_usd: t['prize_pool_usd'] === null ? null : Number(t['prize_pool_usd']),
          teams_count: t['teams_count'],
          starts_at: t['starts_at'],
          ends_at: t['ends_at'],
          logo_url: t['logo_url'],
          status: statusOf(t['starts_at'], t['ends_at']),
          winner: winnerOf.get(t['id']) ?? null,
          matches_count: countOf.get(t['slug']) ?? 0,
        }))
        .sort((a, b) => String(b.starts_at ?? '').localeCompare(String(a.starts_at ?? '')));
    });
  }

  @Get('tournaments/:slug')
  tournament(@Param('slug') slug: string) {
    if (!SLUG.test(slug)) throw new BadRequestException('Endereço inválido.');
    return this.cache.get(`tournament:${slug}`, TTL.content, async () => {
      const { data: t, error } = await this.supabase.db.from('tournaments').select(TOURNAMENT_FIELDS).eq('slug', slug).maybeSingle();
      if (error) throw new InternalServerErrorException('Não foi possível carregar o torneio.');
      if (!t) throw new NotFoundException('Torneio não encontrado.');

      const [{ data: placements, error: pErr }, matches] = await Promise.all([
        this.supabase.db
          .from('tournament_placements')
          .select(`position, place, team_name, prize_usd, teams(${TEAM})`)
          .eq('tournament_id', t.id)
          .order('position'),
        this.allMatches(),
      ]);
      if (pErr) throw new InternalServerErrorException('Não foi possível carregar a classificação.');

      const { id: _id, ...rest } = t as Row;
      return {
        ...rest,
        prize_pool_usd: rest['prize_pool_usd'] === null ? null : Number(rest['prize_pool_usd']),
        status: statusOf(rest['starts_at'], rest['ends_at']),
        placements: ((placements ?? []) as Row[]).map((p) => ({
          place: p['place'],
          team: side(p['teams'], p['team_name']),
          prize_usd: p['prize_usd'] === null ? null : Number(p['prize_usd']),
        })),
        matches: matches.filter((m) => m.tournament?.slug === slug).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
      };
    });
  }

  /**
   * Partidas. status=upcoming (ao vivo + próximas) | results (terminadas) | all.
   * team=<slug> filtra pelas partidas de um time cadastrado.
   */
  @Get('matches')
  async matches(@Query('status') status?: string, @Query('team') team?: string, @Query('limit') limit?: string): Promise<MatchCard[]> {
    if (team && !SLUG.test(team)) throw new BadRequestException('Time inválido.');
    const max = Math.min(Math.max(Number(limit) || 50, 1), 200);
    let list = await this.allMatches();
    if (team) list = list.filter((m) => m.team1.slug === team || m.team2.slug === team);
    if (status === 'upcoming') {
      list = list
        .filter((m) => m.status === 'live' || m.status === 'scheduled')
        .sort((a, b) => Number(b.status === 'live') - Number(a.status === 'live') || a.scheduled_at.localeCompare(b.scheduled_at));
    } else if (status === 'results') {
      list = list.filter((m) => m.status === 'finished').sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
    } else {
      list = [...list].sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
    }
    return list.slice(0, max);
  }

  private allMatches(): Promise<MatchCard[]> {
    return this.cache.get('matches', TTL.content, async () => {
      const { data, error } = await this.supabase.db
        .from('matches')
        .select(
          `id, stage, best_of, scheduled_at, status, team1_score, team2_score, team1_name, team2_name, stream_url,
           tournaments(slug, name),
           team1:teams!matches_team1_id_fkey(${TEAM}),
           team2:teams!matches_team2_id_fkey(${TEAM})`,
        );
      if (error) throw new InternalServerErrorException('Não foi possível carregar as partidas.');
      return ((data ?? []) as Row[]).map((m): MatchCard => {
        const s1 = Number(m['team1_score'] ?? 0);
        const s2 = Number(m['team2_score'] ?? 0);
        return {
          id: m['id'],
          tournament: m['tournaments'] ? { slug: m['tournaments']['slug'], name: m['tournaments']['name'] } : null,
          stage: m['stage'],
          best_of: m['best_of'],
          scheduled_at: m['scheduled_at'],
          status: m['status'],
          team1: side(m['team1'], m['team1_name']),
          team2: side(m['team2'], m['team2_name']),
          score1: s1,
          score2: s2,
          winner: m['status'] === 'finished' && s1 !== s2 ? (s1 > s2 ? 1 : 2) : null,
          stream_url: m['stream_url'],
        };
      });
    });
  }
}

function side(team: Row | null | undefined, fallback: string | null): MatchSide {
  if (team) return { slug: team['slug'], name: team['name'], tag: team['tag'] ?? null, logo_url: team['logo_url'] ?? null };
  return { slug: null, name: fallback || 'A definir', tag: null, logo_url: null };
}

/** Situação do torneio pelas datas (dia em Brasília). */
function statusOf(starts: string | null, ends: string | null): TournamentStatus {
  const today = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (starts && today < starts) return 'upcoming';
  if (ends && today > ends) return 'finished';
  if (!starts && !ends) return 'finished';
  return 'ongoing';
}
