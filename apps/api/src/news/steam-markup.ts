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
  s = s
    .replace(/\[img\][\s\S]*?\[\/img\]/gi, '')
    .replace(/\[previewyoutube=[^\]]*\]\s*\[\/previewyoutube\]/gi, '')
    .replace(/\[video[^\]]*\][\s\S]*?\[\/video\]/gi, '')
    .replace(/\{STEAM_CLAN_IMAGE\}[^\s\[]*/g, '');

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