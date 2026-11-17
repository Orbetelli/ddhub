#!/usr/bin/env node
/**
 * Publica o conteúdo em Markdown do repositório no banco.
 *
 *   npm run content:sync              → grava no Supabase
 *   npm run content:sync -- --dry-run → só valida e mostra o que faria
 *
 * Lê (na raiz do repo):
 *   content/aprender/*.md  → capítulos do guia "Aprender a jogar" (learn_chapters)
 *   content/herois/*.md    → "Como jogar" de cada herói (hero_guides)
 *   content/criadores/*.md → streamers e YouTubers BR (creators)
 *   content/noticias/*.md  → matérias da equipe (articles)
 *   content/cena/times/*.md     → times e elencos (teams, player_team_history)
 *   content/cena/jogadores/*.md → detalhes opcionais dos jogadores (players)
 *
 * Arquivos que começam com "_" (ex.: _modelo.md) são ignorados: servem de modelo.
 *
 * ── Capítulo do guia ────────────────────────────────
 *   ---
 *   slug: lanes
 *   position: 2
 *   title: Lanes
 *   summary: Como funciona a fase de lane.
 *   published: true
 *   ---
 *   (texto em Markdown)
 *
 * ── Guia de herói ───────────────────────────────────
 *   ---
 *   hero: seven            ← slug do herói (o mesmo da URL /herois/seven)
 *   published: true
 *   ---
 *   ## Resumo
 *   ## Pontos fortes       ← lista com "- "
 *   ## Pontos fracos       ← lista com "- "
 *   ## Lane
 *   ## Início de jogo
 *   ## Meio de jogo
 *   ## Fim de jogo
 *   ## Combos
 *   (todas opcionais; outros títulos dão erro, pra evitar texto perdido)
 *
 * ── Criador ─────────────────────────────────────────
 *   ---
 *   slug: fulano
 *   name: Fulano
 *   twitch: fulano_tv          ← só o usuário, sem link
 *   youtube: FulanoGameplay    ← o @ do canal, sem o @
 *   instagram: fulano
 *   tiktok: fulano
 *   kick: fulano
 *   x: fulano
 *   avatar: https://...        ← opcional
 *   tags: Guias, Competitivo
 *   position: 10               ← opcional, ordem na página
 *   published: true
 *   ---
 *   Bio curta em Markdown.
 *
 * ── Notícia ─────────────────────────────────────────
 *   ---
 *   slug: guia-do-patch-novembro
 *   category: guia              ← patch | guia | cenario | comunidade
 *   title: O que mudou no patch de novembro
 *   excerpt: Resumo curto que aparece na lista (até 300 caracteres).
 *   cover: https://...          ← opcional, imagem de capa
 *   date: 2026-11-16            ← opcional (padrão: quando foi publicada)
 *   published: true
 *   ---
 *   Texto em Markdown (aceita os atalhos {{heroi:...}}, {{item:...}} etc.).
 *
 * ── Time ────────────────────────────────────────────
 *   ---
 *   slug: nome-do-time
 *   name: Nome do Time
 *   tag: NDT                   ← sigla (até 6 letras)
 *   country: BR
 *   region: SA
 *   logo: https://...          ← opcional
 *   founded: 2026-01-10        ← opcional
 *   active: true
 *   twitch / youtube / x / discord / startgg   ← opcionais
 *   ---
 *   ## Sobre
 *   Texto curto sobre o time.
 *   ## Elenco
 *   - slug-do-jogador | Nick | função | entrou (AAAA-MM-DD)
 *   ## Ex-integrantes
 *   - slug-do-jogador | Nick | função | entrou | saiu
 *
 * ── Jogador (opcional: só para foto, nome real, redes) ──
 *   ---
 *   slug: slug-do-jogador
 *   nickname: Nick
 *   real_name: Nome Real       ← opcional (só com autorização)
 *   country: BR
 *   steam: 7656119...          ← SteamID64, opcional
 *   photo: https://...         ← opcional
 *   twitch / youtube / x / startgg   ← opcionais
 *   ---
 *   Bio curta em Markdown.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = resolve(here, '../../../content');
const LEARN_DIR = join(CONTENT_ROOT, 'aprender');
const HEROES_DIR = join(CONTENT_ROOT, 'herois');
const CREATORS_DIR = join(CONTENT_ROOT, 'criadores');
const NEWS_DIR = join(CONTENT_ROOT, 'noticias');
const NEWS_CATEGORIES = ['patch', 'guia', 'cenario', 'comunidade'];
const TEAMS_DIR = join(CONTENT_ROOT, 'cena', 'times');
const PLAYERS_DIR = join(CONTENT_ROOT, 'cena', 'jogadores');
const DRY_RUN = process.argv.includes('--dry-run');
const SLUG = /^[a-z0-9-]{1,60}$/;

// Título da seção (normalizado) → coluna em hero_guides
const GUIDE_SECTIONS = {
  'resumo': 'summary_md',
  'pontos fortes': 'strengths',
  'pontos fracos': 'weaknesses',
  'lane': 'lane_md',
  'fase de lane': 'lane_md',
  'inicio de jogo': 'early_md',
  'meio de jogo': 'mid_md',
  'fim de jogo': 'late_md',
  'combos': 'combos_md',
};

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Separa cabeçalho (--- ... ---) e corpo. Aceita BOM e quebras de linha do Windows. */
function splitFrontMatter(file, raw) {
  const match = raw.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error(`${file}: falta o cabeçalho entre "---" no início do arquivo.`);
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: match[2].replace(/\r\n/g, '\n').trim() };
}

async function listMarkdown(dir) {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.md') && !f.startsWith('_')).sort();
  } catch {
    return []; // pasta ainda não existe
  }
}

// ───────────────────────── capítulos ─────────────────────────
function parseChapter(file, raw) {
  const { meta, body } = splitFrontMatter(file, raw);
  const position = Number(meta.position);
  if (!SLUG.test(meta.slug ?? '')) throw new Error(`${file}: "slug" inválido (use letras minúsculas, números e hífen).`);
  if (!Number.isInteger(position) || position < 1) throw new Error(`${file}: "position" precisa ser um número inteiro ≥ 1.`);
  if (!meta.title) throw new Error(`${file}: falta o "title".`);
  if (meta.summary && meta.summary.length > 300) throw new Error(`${file}: "summary" passa de 300 caracteres.`);
  return { slug: meta.slug, position, title: meta.title, summary: meta.summary || null, body_md: body, published: meta.published === 'true' };
}

async function loadChapters() {
  const chapters = [];
  for (const file of await listMarkdown(LEARN_DIR)) {
    chapters.push(parseChapter(file, await readFile(join(LEARN_DIR, file), 'utf8')));
  }
  const dupe = (key) => chapters.find((c, i) => chapters.findIndex((o) => o[key] === c[key]) !== i);
  if (dupe('slug')) throw new Error(`Capítulo com slug repetido: ${dupe('slug').slug}`);
  if (dupe('position')) throw new Error(`Capítulo com posição repetida: ${dupe('position').position}`);
  return chapters;
}

// ───────────────────────── guias de herói ─────────────────────────
function parseHeroGuide(file, raw) {
  const { meta, body } = splitFrontMatter(file, raw);
  if (!SLUG.test(meta.hero ?? '')) throw new Error(`${file}: "hero" inválido (use o slug do herói, ex.: seven, lady-geist).`);

  const guide = {
    hero: meta.hero,
    published: meta.published === 'true',
    summary_md: null, lane_md: null, early_md: null, mid_md: null, late_md: null, combos_md: null,
    strengths: [], weaknesses: [],
  };

  // "## Título" divide as seções: [antes, título1, texto1, título2, texto2, ...]
  const parts = body.split(/^##[ \t]+(.+)$/m);
  if (parts[0].trim()) throw new Error(`${file}: tem texto antes da primeira seção "## ...".`);

  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i].trim();
    const column = GUIDE_SECTIONS[norm(title)];
    if (!column) {
      const valid = 'Resumo, Pontos fortes, Pontos fracos, Lane, Início de jogo, Meio de jogo, Fim de jogo, Combos';
      throw new Error(`${file}: seção "## ${title}" não reconhecida. Use: ${valid}.`);
    }
    const text = (parts[i + 1] ?? '').trim();
    if (column === 'strengths' || column === 'weaknesses') {
      guide[column] = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^[-*]\s+/.test(l))
        .map((l) => l.replace(/^[-*]\s+/, ''));
    } else {
      guide[column] = text || null;
    }
  }
  return guide;
}

async function loadHeroGuides() {
  const guides = [];
  for (const file of await listMarkdown(HEROES_DIR)) {
    guides.push(parseHeroGuide(file, await readFile(join(HEROES_DIR, file), 'utf8')));
  }
  const dupe = guides.find((g, i) => guides.findIndex((o) => o.hero === g.hero) !== i);
  if (dupe) throw new Error(`Dois arquivos para o mesmo herói: ${dupe.hero}`);
  return guides;
}


// ───────────────────────── criadores ─────────────────────────
// Mesmas regras do banco (check constraints): só o usuário, sem link
const HANDLE = {
  twitch: /^[A-Za-z0-9_]{3,25}$/,
  youtube: /^[A-Za-z0-9_.-]{3,60}$/,
  instagram: /^[A-Za-z0-9_.]{1,30}$/,
  tiktok: /^[A-Za-z0-9_.]{2,30}$/,
  kick: /^[A-Za-z0-9_-]{3,30}$/,
  x: /^[A-Za-z0-9_]{1,15}$/,
};

function parseCreator(file, raw) {
  const { meta, body } = splitFrontMatter(file, raw);
  if (!SLUG.test(meta.slug ?? '')) throw new Error(`${file}: "slug" inválido (use letras minúsculas, números e hífen).`);
  if (!meta.name || meta.name.length > 60) throw new Error(`${file}: "name" é obrigatório (até 60 caracteres).`);
  if (body.length > 4000) throw new Error(`${file}: a bio passa de 4000 caracteres.`);

  const handles = {};
  for (const [key, re] of Object.entries(HANDLE)) {
    // Aceita "@fulano" ou um link colado por engano, e guarda só o usuário
    let value = (meta[key] ?? '').trim();
    value = value.replace(/^https?:\/\/[^/]+\/(@)?/i, '').replace(/^@/, '').replace(/\/.*$/, '');
    if (!value) { handles[key] = null; continue; }
    if (!re.test(value)) throw new Error(`${file}: "${key}" inválido: "${meta[key]}" (use só o nome de usuário).`);
    handles[key] = value;
  }
  if (!Object.values(handles).some(Boolean)) throw new Error(`${file}: informe pelo menos uma rede (twitch, youtube...).`);

  if (meta.avatar && !/^https:\/\/\S+$/.test(meta.avatar)) throw new Error(`${file}: "avatar" precisa ser um link https.`);
  const position = meta.position ? Number(meta.position) : 100;
  if (!Number.isInteger(position) || position < 0 || position > 32000) throw new Error(`${file}: "position" inválido.`);

  return {
    slug: meta.slug,
    name: meta.name,
    bio_md: body,
    avatar_url: meta.avatar || null,
    tags: (meta.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6),
    twitch: handles.twitch,
    youtube: handles.youtube,
    instagram: handles.instagram,
    tiktok: handles.tiktok,
    kick: handles.kick,
    x_handle: handles.x,
    position,
    published: meta.published === 'true',
  };
}

async function loadCreators() {
  const creators = [];
  for (const file of await listMarkdown(CREATORS_DIR)) {
    creators.push(parseCreator(file, await readFile(join(CREATORS_DIR, file), 'utf8')));
  }
  const dupe = creators.find((c, i) => creators.findIndex((o) => o.slug === c.slug) !== i);
  if (dupe) throw new Error(`Criador com slug repetido: ${dupe.slug}`);
  const twitch = creators.filter((c) => c.twitch).map((c) => c.twitch.toLowerCase());
  const dupeTwitch = twitch.find((t, i) => twitch.indexOf(t) !== i);
  if (dupeTwitch) throw new Error(`Dois criadores com a mesma Twitch: ${dupeTwitch}`);
  return creators;
}

// ───────────────────────── notícias ─────────────────────────
function parseArticle(file, raw) {
  const { meta, body } = splitFrontMatter(file, raw);
  if (!SLUG.test(meta.slug ?? '') || meta.slug.startsWith('steam-')) {
    throw new Error(`${file}: "slug" inválido (letras minúsculas, números e hífen; não pode começar com "steam-").`);
  }
  if (!NEWS_CATEGORIES.includes(meta.category)) throw new Error(`${file}: "category" deve ser: ${NEWS_CATEGORIES.join(', ')}.`);
  if (!meta.title || meta.title.length < 5 || meta.title.length > 140) throw new Error(`${file}: "title" precisa ter de 5 a 140 caracteres.`);
  if (meta.excerpt && meta.excerpt.length > 300) throw new Error(`${file}: "excerpt" passa de 300 caracteres.`);
  if (meta.cover && !/^https:\/\/\S+$/.test(meta.cover)) throw new Error(`${file}: "cover" precisa ser um link https.`);
  let date = null;
  if (meta.date) {
    const d = new Date(`${meta.date}T12:00:00-03:00`);
    if (Number.isNaN(d.getTime())) throw new Error(`${file}: "date" inválida (use AAAA-MM-DD).`);
    date = d.toISOString();
  }
  if (!body) throw new Error(`${file}: o texto da notícia está vazio.`);
  return {
    slug: meta.slug,
    category: meta.category,
    title: meta.title,
    excerpt: meta.excerpt || null,
    cover_url: meta.cover || null,
    body_md: body,
    date,
    published: meta.published === 'true',
  };
}

async function loadArticles() {
  const articles = [];
  for (const file of await listMarkdown(NEWS_DIR)) {
    articles.push(parseArticle(file, await readFile(join(NEWS_DIR, file), 'utf8')));
  }
  const dupe = articles.find((a, i) => articles.findIndex((o) => o.slug === a.slug) !== i);
  if (dupe) throw new Error(`Notícia com slug repetido: ${dupe.slug}`);
  return articles;
}

async function writeArticles(db, articles) {
  if (articles.length === 0) return;
  const { data: existing, error: readErr } = await db.from('articles').select('slug, published_at');
  if (readErr) throw new Error(`Erro ao ler notícias: ${readErr.message}`);
  const publishedAt = new Map((existing ?? []).map((r) => [r.slug, r.published_at]));
  const now = new Date().toISOString();

  const rows = articles.map(({ published, date, ...a }) => ({
    ...a,
    published_at: published ? (date ?? publishedAt.get(a.slug) ?? now) : null,
  }));
  const { error } = await db.from('articles').upsert(rows, { onConflict: 'slug' });
  if (error) throw new Error(`Erro ao gravar notícias: ${error.message}`);
}

// ───────────────────────── cena: times e jogadores ─────────────────────────
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY = /^[A-Z]{2}$/;

function cleanHandle(file, key, value, re) {
  let v = (value ?? '').trim().replace(/^https?:\/\/[^/]+\/(@)?/i, '').replace(/^@/, '').replace(/\/.*$/, '');
  if (!v) return null;
  if (!re.test(v)) throw new Error(`${file}: "${key}" inválido: "${value}" (use só o nome de usuário).`);
  return v;
}

function checkDate(file, label, value) {
  if (!DATE.test(value) || Number.isNaN(new Date(`${value}T12:00:00Z`).getTime())) {
    throw new Error(`${file}: data inválida em ${label}: "${value}" (use AAAA-MM-DD).`);
  }
  return value;
}

/** Divide o corpo em seções "## Título" → { titulo normalizado: texto } */
function sections(file, body, allowed) {
  const out = {};
  const parts = body.split(/^##[ \t]+(.+)$/m);
  if (parts[0].trim()) throw new Error(`${file}: tem texto antes da primeira seção "## ...".`);
  for (let i = 1; i < parts.length; i += 2) {
    const key = norm(parts[i]);
    if (!allowed.includes(key)) throw new Error(`${file}: seção "## ${parts[i].trim()}" não reconhecida. Use: ${allowed.join(', ')}.`);
    out[key] = (parts[i + 1] ?? '').trim();
  }
  return out;
}

function parseRoster(file, text, former) {
  const rows = [];
  for (const line of (text ?? '').split('\n').map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l))) {
    const cols = line.replace(/^[-*]\s+/, '').split('|').map((c) => c.trim());
    const [slug, nickname, role, joined, left] = cols;
    const where = `linha "${line}"`;
    if (!SLUG.test(slug ?? '')) throw new Error(`${file}: slug do jogador inválido na ${where}.`);
    if (!nickname || nickname.length > 40) throw new Error(`${file}: falta o nick na ${where}.`);
    if (!role || role.length > 20) throw new Error(`${file}: falta a função (jogador, reserva, coach...) na ${where}.`);
    checkDate(file, where, joined ?? '');
    if (former) {
      checkDate(file, where, left ?? '');
      if (left < joined) throw new Error(`${file}: a saída é antes da entrada na ${where}.`);
    } else if (left) {
      throw new Error(`${file}: jogador do elenco atual não tem data de saída (mova para "## Ex-integrantes") na ${where}.`);
    }
    rows.push({ slug, nickname, role: role.toLowerCase(), joined_at: joined, left_at: former ? left : null });
  }
  return rows;
}

function parseTeam(file, raw) {
  const { meta, body } = splitFrontMatter(file, raw);
  if (!SLUG.test(meta.slug ?? '')) throw new Error(`${file}: "slug" inválido.`);
  if (!meta.name || meta.name.length > 60) throw new Error(`${file}: "name" é obrigatório (até 60 caracteres).`);
  if (meta.tag && !/^[A-Za-z0-9]{1,6}$/.test(meta.tag)) throw new Error(`${file}: "tag" deve ter até 6 letras/números.`);
  const country = (meta.country || 'BR').toUpperCase();
  if (!COUNTRY.test(country)) throw new Error(`${file}: "country" deve ter 2 letras (ex.: BR).`);
  if (meta.logo && !/^https:\/\/\S+$/.test(meta.logo)) throw new Error(`${file}: "logo" precisa ser um link https.`);
  if (meta.discord && !/^https:\/\/(discord\.gg|discord\.com)\/\S+$/.test(meta.discord)) throw new Error(`${file}: "discord" precisa ser um convite https://discord.gg/...`);
  if (meta.founded) checkDate(file, '"founded"', meta.founded);

  const sec = sections(file, body, ['sobre', 'elenco', 'ex-integrantes']);
  const roster = [...parseRoster(file, sec['elenco'], false), ...parseRoster(file, sec['ex-integrantes'], true)];

  return {
    team: {
      slug: meta.slug,
      name: meta.name,
      tag: meta.tag ? meta.tag.toUpperCase() : null,
      region: (meta.region || 'SA').toUpperCase(),
      country,
      logo_url: meta.logo || null,
      founded_at: meta.founded || null,
      is_active: meta.active !== 'false',
      bio_md: sec['sobre'] ?? '',
      twitch: cleanHandle(file, 'twitch', meta.twitch, HANDLE.twitch),
      youtube: cleanHandle(file, 'youtube', meta.youtube, HANDLE.youtube),
      x_handle: cleanHandle(file, 'x', meta.x, HANDLE.x),
      discord_url: meta.discord || null,
      startgg_slug: meta.startgg || null,
    },
    roster,
  };
}

function parsePlayer(file, raw) {
  const { meta, body } = splitFrontMatter(file, raw);
  if (!SLUG.test(meta.slug ?? '')) throw new Error(`${file}: "slug" inválido.`);
  if (!meta.nickname || meta.nickname.length > 40) throw new Error(`${file}: "nickname" é obrigatório (até 40 caracteres).`);
  const country = meta.country ? meta.country.toUpperCase() : null;
  if (country && !COUNTRY.test(country)) throw new Error(`${file}: "country" deve ter 2 letras (ex.: BR).`);
  if (meta.steam && !/^[0-9]{17}$/.test(meta.steam)) throw new Error(`${file}: "steam" deve ser o SteamID64 (17 números).`);
  if (meta.photo && !/^https:\/\/\S+$/.test(meta.photo)) throw new Error(`${file}: "photo" precisa ser um link https.`);
  if (body.length > 4000) throw new Error(`${file}: a bio passa de 4000 caracteres.`);
  return {
    slug: meta.slug,
    nickname: meta.nickname,
    real_name: meta.real_name || null,
    country,
    steam_id64: meta.steam || null,
    photo_url: meta.photo || null,
    bio_md: body,
    twitch: cleanHandle(file, 'twitch', meta.twitch, HANDLE.twitch),
    youtube: cleanHandle(file, 'youtube', meta.youtube, HANDLE.youtube),
    x_handle: cleanHandle(file, 'x', meta.x, HANDLE.x),
    startgg_slug: meta.startgg || null,
  };
}

async function loadScene() {
  const players = new Map();
  for (const file of await listMarkdown(PLAYERS_DIR)) {
    const p = parsePlayer(file, await readFile(join(PLAYERS_DIR, file), 'utf8'));
    if (players.has(p.slug)) throw new Error(`Jogador com slug repetido: ${p.slug}`);
    players.set(p.slug, p);
  }

  const teams = [];
  for (const file of await listMarkdown(TEAMS_DIR)) teams.push(parseTeam(file, await readFile(join(TEAMS_DIR, file), 'utf8')));
  const dupe = teams.find((t, i) => teams.findIndex((o) => o.team.slug === t.team.slug) !== i);
  if (dupe) throw new Error(`Time com slug repetido: ${dupe.team.slug}`);

  // Jogador citado no elenco sem arquivo próprio: cria com o nick da linha
  const currentTeamOf = new Map();
  for (const { team, roster } of teams) {
    for (const r of roster) {
      if (!players.has(r.slug)) {
        players.set(r.slug, {
          slug: r.slug, nickname: r.nickname, real_name: null, country: null, steam_id64: null, photo_url: null,
          bio_md: '', twitch: null, youtube: null, x_handle: null, startgg_slug: null,
        });
      }
      if (!r.left_at) {
        const other = currentTeamOf.get(r.slug);
        if (other && other !== team.slug) throw new Error(`"${r.slug}" está no elenco atual de dois times: ${other} e ${team.slug}.`);
        currentTeamOf.set(r.slug, team.slug);
      }
    }
  }
  return { teams, players: [...players.values()] };
}

async function writeScene(db, scene) {
  if (scene.teams.length === 0 && scene.players.length === 0) return;

  if (scene.players.length) {
    const { error } = await db.from('players').upsert(scene.players, { onConflict: 'slug' });
    if (error) throw new Error(`Erro ao gravar jogadores: ${error.message} (a migration da cena já foi aplicada?)`);
  }
  if (scene.teams.length) {
    const { error } = await db.from('teams').upsert(scene.teams.map((t) => t.team), { onConflict: 'slug' });
    if (error) throw new Error(`Erro ao gravar times: ${error.message} (a migration da cena já foi aplicada?)`);
  }

  const [{ data: teamRows, error: tErr }, { data: playerRows, error: pErr }] = await Promise.all([
    db.from('teams').select('id, slug'),
    db.from('players').select('id, slug'),
  ]);
  if (tErr || pErr) throw new Error(`Erro ao ler a cena: ${(tErr ?? pErr).message}`);
  const teamId = new Map(teamRows.map((r) => [r.slug, r.id]));
  const playerId = new Map(playerRows.map((r) => [r.slug, r.id]));

  // O histórico dos times que têm arquivo é refeito a partir dos arquivos
  const ids = scene.teams.map((t) => teamId.get(t.team.slug));
  if (ids.length) {
    const { error } = await db.from('player_team_history').delete().in('team_id', ids);
    if (error) throw new Error(`Erro ao limpar elencos: ${error.message}`);
  }
  const history = scene.teams.flatMap(({ team, roster }) =>
    roster.map((r) => ({
      player_id: playerId.get(r.slug),
      team_id: teamId.get(team.slug),
      role: r.role,
      joined_at: r.joined_at,
      left_at: r.left_at,
    })),
  );
  if (history.length) {
    const { error } = await db.from('player_team_history').insert(history);
    if (error) throw new Error(`Erro ao gravar elencos: ${error.message}`);
  }

  const orphans = teamRows.filter((r) => !scene.teams.some((t) => t.team.slug === r.slug));
  if (orphans.length) console.warn(`⚠️  Times no banco sem arquivo: ${orphans.map((o) => o.slug).join(', ')} (não alterados).`);
}

// ───────────────────────── gravação ─────────────────────────
async function writeChapters(db, chapters) {
  const { data: existing, error: readErr } = await db.from('learn_chapters').select('slug, published_at');
  if (readErr) throw new Error(`Erro ao ler capítulos: ${readErr.message}`);
  const publishedAt = new Map((existing ?? []).map((r) => [r.slug, r.published_at]));
  const now = new Date().toISOString();

  const rows = chapters.map((c) => ({
    slug: c.slug, position: c.position, title: c.title, summary: c.summary, body_md: c.body_md,
    published_at: c.published ? (publishedAt.get(c.slug) ?? now) : null,
  }));

  // Duas passadas: posições temporárias primeiro, para trocar a ordem sem esbarrar na "posição única"
  for (const batch of [rows.map((r) => ({ ...r, position: r.position + 1000 })), rows]) {
    const { error } = await db.from('learn_chapters').upsert(batch, { onConflict: 'slug' });
    if (error) throw new Error(`Erro ao gravar capítulos: ${error.message}`);
  }
  const orphans = (existing ?? []).filter((r) => !chapters.some((c) => c.slug === r.slug));
  if (orphans.length) console.warn(`⚠️  Capítulos no banco sem arquivo: ${orphans.map((o) => o.slug).join(', ')} (não alterados).`);
}

async function writeHeroGuides(db, guides) {
  if (guides.length === 0) return;
  const { data: heroes, error: heroErr } = await db.from('heroes').select('id, slug');
  if (heroErr) throw new Error(`Erro ao ler heróis: ${heroErr.message}`);
  const idBySlug = new Map((heroes ?? []).map((h) => [h.slug, h.id]));

  // Slug errado em um arquivo não trava os outros: avisa e pula
  const unknown = guides.filter((g) => !idBySlug.has(g.hero)).map((g) => g.hero);
  if (unknown.length) {
    console.warn(`⚠️  Herói não encontrado no banco (arquivo pulado): ${unknown.join(', ')}. Confira o slug na URL de /herois.`);
    guides = guides.filter((g) => idBySlug.has(g.hero));
    if (guides.length === 0) return;
  }

  const { data: existing, error: readErr } = await db.from('hero_guides').select('hero_id, published_at');
  if (readErr) throw new Error(`Erro ao ler guias: ${readErr.message}`);
  const publishedAt = new Map((existing ?? []).map((r) => [r.hero_id, r.published_at]));
  const now = new Date().toISOString();

  const rows = guides.map((g) => {
    const heroId = idBySlug.get(g.hero);
    return {
      hero_id: heroId,
      summary_md: g.summary_md, lane_md: g.lane_md, early_md: g.early_md, mid_md: g.mid_md,
      late_md: g.late_md, combos_md: g.combos_md, strengths: g.strengths, weaknesses: g.weaknesses,
      published_at: g.published ? (publishedAt.get(heroId) ?? now) : null,
    };
  });
  const { error } = await db.from('hero_guides').upsert(rows, { onConflict: 'hero_id' });
  if (error) throw new Error(`Erro ao gravar guias de herói: ${error.message}`);
}

async function writeCreators(db, creators) {
  if (creators.length === 0) return;
  const { data: existing, error: readErr } = await db.from('creators').select('slug, published_at');
  if (readErr) throw new Error(`Erro ao ler criadores: ${readErr.message} (a migration de criadores já foi aplicada?)`);
  const publishedAt = new Map((existing ?? []).map((r) => [r.slug, r.published_at]));
  const now = new Date().toISOString();

  const rows = creators.map(({ published, ...c }) => ({
    ...c,
    published_at: published ? (publishedAt.get(c.slug) ?? now) : null,
  }));
  const { error } = await db.from('creators').upsert(rows, { onConflict: 'slug' });
  if (error) throw new Error(`Erro ao gravar criadores: ${error.message}`);

  const orphans = (existing ?? []).filter((r) => !creators.some((c) => c.slug === r.slug));
  if (orphans.length) console.warn(`⚠️  Criadores no banco sem arquivo: ${orphans.map((o) => o.slug).join(', ')} (não alterados).`);
}

/** Pede para a API (se estiver rodando) limpar o cache, para o conteúdo novo aparecer na hora. */
async function clearApiCache() {
  const token = process.env.ADMIN_SYNC_TOKEN;
  const base = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
  if (!token) {
    console.log('ℹ️  Sem ADMIN_SYNC_TOKEN: o site mostra o conteúdo novo em até 10 min (ou reinicie a API).');
    return;
  }
  try {
    const res = await fetch(`${base}/admin/cache/clear`, {
      method: 'POST',
      headers: { 'x-admin-token': token },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) console.log('🧹 Cache da API limpo: o site já mostra o conteúdo novo.');
    else console.log(`ℹ️  A API respondeu ${res.status} ao limpar o cache. O conteúdo aparece em até 10 min.`);
  } catch {
    console.log('ℹ️  API não está rodando: nada para limpar.');
  }
}

async function main() {
  const chapters = await loadChapters();
  const guides = await loadHeroGuides();
  const creators = await loadCreators();
  const articles = await loadArticles();
  const scene = await loadScene();

  console.log(`📚 ${chapters.length} capítulos em ${LEARN_DIR}`);
  for (const c of chapters) {
    console.log(`  ${String(c.position).padStart(2)}. ${c.slug.padEnd(12)} ${c.published ? 'publicado ' : 'rascunho  '} ${c.body_md.length} caracteres`);
  }
  console.log(`\n🦸 ${guides.length} guias de herói em ${HEROES_DIR}`);
  for (const g of guides) {
    const filled = ['summary_md', 'lane_md', 'early_md', 'mid_md', 'late_md', 'combos_md'].filter((k) => g[k]).length;
    console.log(`  ${g.hero.padEnd(14)} ${g.published ? 'publicado ' : 'rascunho  '} ${filled}/6 seções · ${g.strengths.length} fortes · ${g.weaknesses.length} fracos`);
  }

  console.log(`\n🎥 ${creators.length} criadores em ${CREATORS_DIR}`);
  for (const c of creators) {
    const nets = ['twitch', 'youtube', 'instagram', 'tiktok', 'kick', 'x_handle'].filter((k) => c[k]).map((k) => k.replace('_handle', ''));
    console.log(`  ${c.slug.padEnd(16)} ${c.published ? 'publicado ' : 'rascunho  '} ${nets.join(', ')}`);
  }

  console.log(`\n📰 ${articles.length} notícias em ${NEWS_DIR}`);
  for (const a of articles) {
    console.log(`  ${a.slug.padEnd(28)} ${a.published ? 'publicada ' : 'rascunho  '} ${a.category}`);
  }

  console.log(`\n🏆 ${scene.teams.length} times e ${scene.players.length} jogadores em ${join(CONTENT_ROOT, 'cena')}`);
  for (const { team, roster } of scene.teams) {
    const atual = roster.filter((r) => !r.left_at).length;
    console.log(`  ${team.slug.padEnd(20)} ${team.tag ?? '—'}  ${atual} no elenco · ${roster.length - atual} ex-integrantes`);
  }

  if (DRY_RUN) {
    console.log('\n(--dry-run) Nada foi gravado.');
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não definidos (rode pelo "npm run content:sync").');

  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  await writeChapters(db, chapters);
  await writeHeroGuides(db, guides);
  await writeCreators(db, creators);
  await writeArticles(db, articles);
  await writeScene(db, scene);
  console.log('\n✅ Conteúdo sincronizado.');
  await clearApiCache();
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
