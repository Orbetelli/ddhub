import { AssetRefs } from '../../core/models/asset-refs.models';

/**
 * Atalhos aceitos no Markdown do DDhub:
 *
 *   {{heroi:seven}}          → chip com ícone + nome, linka pra página do herói
 *   {{item:clip-size}}       → chip com ícone + nome do item (cor do slot), linka pra /itens/clip-size
 *   {{npc:plant-strong}}     → chip com imagem + nome do monstro/estrutura
 *   {{imagem:mapa}}          → imagem grande com legenda
 *   {{imagem:mapa|Legenda}}  → idem, com legenda personalizada
 *   {{icone:neutral_small.png}} → ícone pequeno no meio do texto
 *   {{habilidade:seven:1}}   → chip com ícone + nome oficial da habilidade (1–3, 4 = ultimate)
 *
 * Atalho com nome errado aparece destacado em vermelho, pra quem escreve perceber.
 */

type NameFn = (name: string, nameEn: string | null) => string;

const SHORTCODE = /\{\{\s*(heroi|herói|item|npc|imagem|icone|ícone|habilidade)\s*:\s*([a-z0-9._:-]+)\s*(?:\|([^}]*))?\}\}/gi;

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function chip(kind: string, label: string, image: string | null, href?: string, extraClass = ''): string {
  const img = image ? `<img src="${esc(image)}" alt="" loading="lazy" width="22" height="22">` : '';
  const inner = `${img}<span>${esc(label)}</span>`;
  const cls = `ref ref--${kind}${extraClass ? ' ' + extraClass : ''}`;
  return href ? `<a class="${cls}" href="${esc(href)}">${inner}</a>` : `<span class="${cls}">${inner}</span>`;
}

function missing(raw: string): string {
  return `<span class="ref ref--missing" title="Atalho não encontrado">${esc(raw)}</span>`;
}

export function expandShortcodes(source: string, refs: AssetRefs, displayName: NameFn): string {
  return source.replace(SHORTCODE, (raw, rawKind: string, key: string, caption?: string) => {
    const kind = rawKind.toLowerCase();

    if (kind === 'heroi' || kind === 'herói') {
      const h = refs.heroes[key];
      return h ? chip('hero', displayName(h.name, h.name_en), h.image, `/herois/${key}`) : missing(raw);
    }
    if (kind === 'item') {
      const it = refs.items[key];
      if (!it) return missing(raw);
      // Item da loja (tem slot) linka para /itens/...; habilidade fica só como chip
      const href = it.slot ? `/itens/${key}` : undefined;
      return chip('item', displayName(it.name, it.name_en), it.image, href, it.slot ? `ref--${it.slot}` : '');
    }
    if (kind === 'habilidade') {
      const ab = refs.abilities?.[key];
      const slot = key.split(':')[1];
      const extra = slot === '4' ? 'ref--ultimate' : '';
      return ab ? chip('ability', displayName(ab.name, ab.name_en), ab.image, undefined, extra) : missing(raw);
    }
    if (kind === 'npc') {
      const n = refs.npcs[key];
      return n ? chip('npc', displayName(n.name, n.name_en), n.image) : missing(raw);
    }

    if (kind === 'icone' || kind === 'ícone') {
      const url = refs.icons?.[key];
      const alt = caption?.trim() ?? '';
      return url ? `<img class="md-icon" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" width="24" height="24">` : missing(raw);
    }

    // imagem
    const img = refs.images[key];
    if (!img) return missing(raw);
    const legend = caption?.trim() || img.alt;
    // Linhas em branco em volta: o Markdown trata como bloco próprio
    return `\n\n<figure class="md-figure"><img src="${esc(img.url)}" alt="${esc(img.alt)}" loading="lazy"><figcaption>${esc(legend)}</figcaption></figure>\n\n`;
  });
}