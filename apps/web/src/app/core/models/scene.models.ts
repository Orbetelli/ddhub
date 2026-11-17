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