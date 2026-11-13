export interface RefEntry {
  name: string;
  name_en: string | null;
  image: string | null;
}

export interface AssetRefs {
  heroes: Record<string, RefEntry>;
  items: Record<string, RefEntry & { slot: string | null }>;
  npcs: Record<string, RefEntry>;
  images: Record<string, { url: string; alt: string }>;
  icons: Record<string, string>;
  /** "seven:1" → habilidade 1 do Sete (4 = ultimate) */
  abilities: Record<string, RefEntry>;
}

export const EMPTY_REFS: AssetRefs = { heroes: {}, items: {}, npcs: {}, images: {}, icons: {}, abilities: {} };