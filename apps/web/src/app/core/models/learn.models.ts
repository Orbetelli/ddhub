export interface ChapterSummary {
  slug: string;
  position: number;
  title: string;
  summary: string | null;
}

export interface Chapter extends ChapterSummary {
  body_md: string;
  updated_at: string;
  prev: ChapterSummary | null;
  next: ChapterSummary | null;
}