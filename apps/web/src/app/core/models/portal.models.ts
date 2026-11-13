// Modelos do front. Espelham as tabelas do Supabase (migration inicial),
// mas só com o que as telas precisam.

export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'canceled';
export type ArticleCategory = 'patch' | 'guia' | 'cenario' | 'comunidade';

export interface TeamRef {
  slug: string;
  name: string;
  tag?: string;
}

export interface Match {
  id: string;
  tournament: string;
  team1: TeamRef;
  team2: TeamRef;
  team1Score: number;
  team2Score: number;
  bestOf: number;
  status: MatchStatus;
  scheduledAt: string; // ISO 8601
}

export interface Tournament {
  slug: string;
  name: string;
  statusLabel: string;
}

export interface Article {
  slug: string;
  category: ArticleCategory;
  title: string;
  excerpt?: string;
  coverUrl?: string;
  publishedAt: string; // ISO 8601
  commentCount: number;
}

export interface Transfer {
  id: string;
  player: string;
  from: string | null; // null = sem time
  to: string | null;
  happenedAt: string; // ISO 8601 (data)
}

export interface ForumTopic {
  id: string;
  title: string;
  category: string;
  replyCount: number;
}

export interface HeroStat {
  slug: string;
  name: string;
  winRate: number | null; // virá do Deadlock API
}

export interface BuildSummary {
  id: string;
  hero: string;
  title: string;
  author: string;
  score: number;
}

export const ARTICLE_CATEGORY_LABEL: Record<ArticleCategory, string> = {
  patch: 'Patch',
  guia: 'Guia',
  cenario: 'Cenário',
  comunidade: 'Comunidade',
};
