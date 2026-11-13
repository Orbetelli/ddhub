// Formato da resposta de GET /creators (API NestJS)

export interface Creator {
  slug: string;
  name: string;
  bio_md: string;
  avatar_url: string | null;
  tags: string[];
  twitch: string | null;
  youtube: string | null;
  instagram: string | null;
  tiktok: string | null;
  kick: string | null;
  x_handle: string | null;
}

export type Platform = 'twitch' | 'youtube' | 'kick' | 'instagram' | 'tiktok' | 'x';

export interface PlatformLink {
  platform: Platform;
  label: string;
  url: string;
}

const PLATFORMS: { platform: Platform; label: string; key: keyof Creator; url: (u: string) => string }[] = [
  { platform: 'twitch', label: 'Twitch', key: 'twitch', url: (u) => `https://www.twitch.tv/${u}` },
  { platform: 'youtube', label: 'YouTube', key: 'youtube', url: (u) => `https://www.youtube.com/@${u}` },
  { platform: 'kick', label: 'Kick', key: 'kick', url: (u) => `https://kick.com/${u}` },
  { platform: 'instagram', label: 'Instagram', key: 'instagram', url: (u) => `https://www.instagram.com/${u}` },
  { platform: 'tiktok', label: 'TikTok', key: 'tiktok', url: (u) => `https://www.tiktok.com/@${u}` },
  { platform: 'x', label: 'X', key: 'x_handle', url: (u) => `https://x.com/${u}` },
];

/** Links das redes do criador, na ordem: lives primeiro, depois redes sociais. */
export function platformLinks(c: Creator): PlatformLink[] {
  return PLATFORMS.flatMap((p) => {
    const user = c[p.key];
    return typeof user === 'string' && user ? [{ platform: p.platform, label: p.label, url: p.url(encodeURIComponent(user)) }] : [];
  });
}