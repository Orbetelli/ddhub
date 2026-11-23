// Formato da resposta de GET /live (API NestJS)

export interface LiveStream {
  slug: string;
  name: string;
  /** Onde é a live */
  platform: 'twitch' | 'kick';
  twitch: string;
  avatar: string | null;
  title: string;
  viewers: number;
  started_at: string;
  thumbnail: string;
  url: string;
}

export interface LiveSnapshot {
  /** false enquanto a integração com a Twitch não estiver configurada na API */
  enabled: boolean;
  updated_at: string | null;
  streams: LiveStream[];
}

export const EMPTY_LIVE: LiveSnapshot = { enabled: false, updated_at: null, streams: [] };
