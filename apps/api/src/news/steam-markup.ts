/**
 * Converte o texto dos anúncios da Steam (BBCode + texto puro) para Markdown,
 * que o site já sabe renderizar com segurança (<app-markdown>).
 *
 * Os anúncios de patch do Deadlock costumam vir assim:
 *   [ General ]
 *   - Fixed something
 *   [list][*]Item[/list]   [h2]Título[/h2]   [url=https://...]texto[/url]
 */
export function steamToMarkdown(raw: string): string {
  let s = (raw ?? '').replace(/\r\n?/g, '\n');

  // Imagens e vídeos incorporados: o site não mostra (ficam no link original)
  s = stripSteamMedia(s);

  // Títulos e parágrafos
  s = s
    .replace(/\[h1\]([\s\S]*?)\[\/h1\]/gi, '\n\n## $1\n\n')
    .replace(/\[h2\]([\s\S]*?)\[\/h2\]/gi, '\n\n### $1\n\n')
    .replace(/\[h3\]([\s\S]*?)\[\/h3\]/gi, '\n\n#### $1\n\n')
    .replace(/\[p\]/gi, '\n')
    .replace(/\[\/p\]/gi, '\n')
    .replace(/\[br\]/gi, '\n')
    .replace(/\[hr\]\[\/hr\]|\[hr\]/gi, '\n\n---\n\n');

  // Listas
  s = s
    .replace(/\[\*\]\s*/g, '\n- ')
    .replace(/\[\/\*\]/g, '')
    .replace(/\[\/?(list|olist)[^\]]*\]/gi, '\n');

  // Links viram marcadores temporários (para a limpeza de tags não apagar o texto)
  const links: string[] = [];
  s = s
    .replace(/\[url=["']?([^\]"']+)["']?\]([\s\S]*?)\[\/url\]/gi, (_m, href: string, text: string) => {
      if (!/^https?:\/\//i.test(href)) return text;
      links.push(`[${text.trim().replace(/[[\]]/g, '') || href}](${href})`);
      return `\u0000${links.length - 1}\u0000`;
    })
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '$1')
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '**$1**')
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '*$1*')
    .replace(/\[(u|strike|spoiler|noparse|quote|code|table|tr|td|th)[^\]]*\]/gi, '')
    .replace(/\[\/(u|strike|spoiler|noparse|quote|code|table|tr|td|th)\]/gi, '');

  // Cabeçalhos no estilo do Deadlock: "[ General ]" sozinho na linha → título
  s = s.replace(/^[ \t]*\[ ?([^\]\n]{2,60}?) ?\][ \t]*$/gm, '\n### $1\n');

  // Qualquer outra tag BBCode que sobrou
  s = s.replace(/\[\/?[a-z0-9]+(=[^\]]*)?\]/gi, '');

  // Linhas de lista com "•" ou "*" viram "- "
  s = s.replace(/^[ \t]*[•*][ \t]+/gm, '- ');

  // Devolve os links
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => links[Number(i)] ?? '');

  // Espaços e quebras
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    // Itens de lista separados por linha em branco ficam juntos
    .replace(/(^- .*)\n\n(?=- )/gm, '$1\n')
    .trim();
}

/**
 * Remove imagens, vídeos e marcadores de mídia da Steam. Cobre os dois formatos:
 *   [img]{STEAM_CLAN_IMAGE}/x.png[/img]   e   [img src="{STEAM_CLAN_LOC_IMAGE}/x.png"]
 * Também serve para limpar traduções que já estão salvas no banco.
 */
export function stripSteamMedia(text: string): string {
  return (text ?? '')
    .replace(/\[img\b[^\]]*\][\s\S]*?\[\/img\]/gi, '')
    .replace(/\[\s*img\b[^\]]*\]/gi, '')
    .replace(/\[\/img\]/gi, '')
    .replace(/\[previewyoutube[^\]]*\][\s\S]*?\[\/previewyoutube\]/gi, '')
    .replace(/\[\s*previewyoutube[^\]]*\]/gi, '')
    .replace(/\[video[^\]]*\][\s\S]*?\[\/video\]/gi, '')
    .replace(/\[\s*video\b[^\]]*\]/gi, '')
    .replace(/\{STEAM_CLAN(?:_LOC)?_IMAGE\}[^\s\[\]"]*/g, '');
}

/** Resumo curto em texto puro (para listas). */
export function excerptFrom(markdown: string, max = 220): string {
  const text = markdown
    .replace(/^#+\s.*$/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const STEAM_CLAN_IMAGES = 'https://clan.akamai.steamstatic.com/images/';

/** Primeira imagem de um anúncio da Steam (banner), para usar de capa. null se não tiver. */
export function firstSteamImage(raw: string): string | null {
  const m =
    /\[img\s+src=["']?([^"'\]\s]+)["']?[^\]]*\]/i.exec(raw ?? '') ?? /\[img\]\s*([^\[\s]+)\s*\[\/img\]/i.exec(raw ?? '');
  if (!m) return null;
  const url = m[1].replace(/^\{STEAM_CLAN(?:_LOC)?_IMAGE\}\/?/, STEAM_CLAN_IMAGES).replace(/^http:\/\//i, 'https://');
  return /^https:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?$/i.test(url) ? url : null;
}

/** Heróis citados no texto do patch (pelo nome em inglês, como a Valve escreve). */
export function heroesMentioned<T extends { name_en: string | null }>(raw: string, heroes: T[]): T[] {
  const text = steamToMarkdown(raw ?? '');
  return heroes.filter((h) => {
    const name = h.name_en?.trim();
    if (!name || name.length < 3) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s*&\s*/g, '\\s*(?:&|and)\\s*');
    return new RegExp(`(^|[^A-Za-z])${escaped}([^A-Za-z]|$)`).test(text);
  });
}
