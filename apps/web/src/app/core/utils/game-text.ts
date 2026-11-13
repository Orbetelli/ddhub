/**
 * Textos que vêm do jogo (descrições e atributos de itens/habilidades).
 * Vêm com HTML e marcadores próprios ({g:...}, {s:sign}); aqui viram texto limpo.
 */

/** Remove HTML e marcadores do jogo, mantendo as quebras de linha. */
export function plainText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Todos os textos de uma descrição do jogo, sem repetição, com "desc" primeiro. */
export function descriptionParagraphs(description: Record<string, unknown> | null | undefined): string[] {
  const d = description ?? {};
  const keys = Object.keys(d).sort((a, b) => (a === 'desc' ? -1 : b === 'desc' ? 1 : 0));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    const text = plainText(d[k]);
    if (text && !seen.has(text)) {
      seen.add(text);
      out.push(text);
    }
  }
  return out;
}

interface GameProperty {
  label?: string;
  value?: string | number;
  prefix?: string;
  postfix?: string;
  disable_value?: string | number;
}

/** Atributos com rótulo e valor diferente de zero → "+20% Velocidade de ataque". */
export function propertyLines(properties: Record<string, GameProperty> | null | undefined, max = 16): string[] {
  const lines: string[] = [];
  for (const p of Object.values(properties ?? {})) {
    if (!p?.label || p.value === undefined || p.value === null || p.value === '') continue;
    const num = Number(p.value);
    if (!Number.isNaN(num) && num === 0) continue;
    if (p.disable_value !== undefined && String(p.disable_value) === String(p.value)) continue;

    const sign = !Number.isNaN(num) && num > 0 ? '+' : '';
    const prefix = (p.prefix ?? '').replace('{s:sign}', sign).replace(/\{[^}]*\}/g, '');
    const label = plainText(p.label);
    if (!label) continue;
    lines.push(`${prefix}${p.value}${p.postfix ?? ''} ${label}`.trim());
    if (lines.length >= max) break;
  }
  return lines;
}