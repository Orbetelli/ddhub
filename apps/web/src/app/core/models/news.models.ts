// Formato das respostas de GET /news, /news/:slug e /meta (API NestJS)
import { ArticleCategory } from './portal.models';

export interface NewsItem {
  slug: string;
  /** article = matéria do DDhub · official = anúncio oficial da Valve (Steam) */
  kind: 'article' | 'official';
  category: ArticleCategory;
  title: string;
  excerpt: string | null;
  cover_url: string | null;
  published_at: string;
}

export interface NewsDetail extends NewsItem {
  body_md: string;
  source_url: string | null;
}

export interface SiteMeta {
  patch: { slug: string; title: string; published_at: string } | null;
}