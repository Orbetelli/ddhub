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
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = resolve(here, '../../../content');
const LEARN_DIR = join(CONTENT_ROOT, 'aprender');
const HEROES_DIR = join(CONTENT_ROOT, 'herois');
const CREATORS_DIR = join(CONTENT_ROOT, 'criadores');
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
  console.log('\n✅ Conteúdo sincronizado.');
  await clearApiCache();
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
