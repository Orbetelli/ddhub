// Formato das respostas de /teams, /teams/:slug, /players/:slug e /transfers (API NestJS)

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

export interface PlayerRef {
  slug: string;
  nickname: string;
  real_name: string | null;
  country: string | null;
  photo_url: string | null;
}

export interface Membership extends PlayerRef {
  role: string | null;
  joined_at: string;
  left_at: string | null;
}

export interface TeamDetail extends Omit<TeamCard, 'roster_count'> {
  bio_md: string;
  twitch: string | null;
  youtube: string | null;
  x_handle: string | null;
  discord_url: string | null;
  roster: Membership[];
  former: Membership[];
}

export interface TeamRef {
  slug: string;
  name: string;
  tag: string | null;
  logo_url: string | null;
}

export interface TeamStint extends TeamRef {
  role: string | null;
  joined_at: string;
  left_at: string | null;
}

export interface PlayerDetail extends PlayerRef {
  bio_md: string;
  twitch: string | null;
  youtube: string | null;
  x_handle: string | null;
  current_team: TeamStint | null;
  teams: TeamStint[];
}

export interface TransferEvent {
  kind: 'join' | 'leave';
  date: string;
  role: string | null;
  player: PlayerRef;
  team: TeamRef;
}

/** Iniciais para quando não há logo/foto. */
export function initials(text: string): string {
  return text
    .split(/[\s-_]+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

/** Links das redes (mesmo padrão da página de criadores). */
export function socialLinks(x: { twitch?: string | null; youtube?: string | null; x_handle?: string | null; discord_url?: string | null }) {
  const out: { label: string; url: string; kind: string }[] = [];
  if (x.twitch) out.push({ kind: 'twitch', label: 'Twitch', url: `https://www.twitch.tv/${encodeURIComponent(x.twitch)}` });
  if (x.youtube) out.push({ kind: 'youtube', label: 'YouTube', url: `https://www.youtube.com/@${encodeURIComponent(x.youtube)}` });
  if (x.x_handle) out.push({ kind: 'x', label: 'X', url: `https://x.com/${encodeURIComponent(x.x_handle)}` });
  if (x.discord_url) out.push({ kind: 'discord', label: 'Discord', url: x.discord_url });
  return out;
}

// ───────── Torneios e partidas (GET /tournaments, /tournaments/:slug, /matches) ─────────

export interface MatchSide {
  /** null = time sem cadastro (seleção, time de fora): só o nome, sem link */
  slug: string | null;
  name: string;
  tag: string | null;
  logo_url: string | null;
}

export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'canceled';

export interface MatchCard {
  id: string;
  tournament: { slug: string; name: string } | null;
  stage: string | null;
  best_of: number;
  scheduled_at: string;
  status: MatchStatus;
  team1: MatchSide;
  team2: MatchSide;
  score1: number;
  score2: number;
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

export interface Placement {
  place: string;
  team: MatchSide;
  prize_usd: number | null;
}

export interface TournamentDetail extends Omit<TournamentCard, 'winner' | 'matches_count'> {
  bio_md: string;
  external_url: string | null;
  startgg_slug: string | null;
  placements: Placement[];
  matches: MatchCard[];
}

export const TOURNAMENT_STATUS_LABEL: Record<TournamentStatus, string> = {
  upcoming: 'Em breve',
  ongoing: 'Em andamento',
  finished: 'Encerrado',
};

/** "14–15 nov 2026", "26 fev – 1 mar 2026" */
export function dateRange(starts: string | null, ends: string | null): string {
  if (!starts) return '';
  const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
  const fmt = (x: Date, opts: Intl.DateTimeFormatOptions) => x.toLocaleDateString('pt-BR', { timeZone: 'UTC', ...opts });
  const a = d(starts);
  const b = ends ? d(ends) : a;
  const month = (x: Date) => fmt(x, { month: 'short' }).replace('.', '');
  if (a.getTime() === b.getTime()) return `${a.getUTCDate()} ${month(a)} ${a.getUTCFullYear()}`;
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) {
    return `${a.getUTCDate()}–${b.getUTCDate()} ${month(a)} ${a.getUTCFullYear()}`;
  }
  return `${a.getUTCDate()} ${month(a)} – ${b.getUTCDate()} ${month(b)} ${b.getUTCFullYear()}`;
}

/** US$ 1.234 */
export function usd(value: number | null): string {
  return value === null ? '' : `US$ ${value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}
