#!/usr/bin/env node
/**
 * Envia os capítulos do guia "Aprender" (Markdown) para o banco.
 *
 *   npm run content:sync              → grava no Supabase
 *   npm run content:sync -- --dry-run → só valida e mostra o que faria
 *
 * Lê: <raiz do repo>/content/aprender/*.md
 * Cada arquivo começa com um cabeçalho:
 *
 *   ---
 *   slug: lanes
 *   position: 2
 *   title: Lanes
 *   summary: Como funciona a fase de lane.
 *   published: true
 *   ---
 *   (texto em Markdown)
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = resolve(here, '../../../content/aprender');
const DRY_RUN = process.argv.includes('--dry-run');
const SLUG = /^[a-z0-9-]{1,60}$/;

function parseChapter(file, raw) {
  const match = raw.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error(`${file}: falta o cabeçalho entre "---" no início do arquivo.`);

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }

  const position = Number(meta.position);
  if (!SLUG.test(meta.slug ?? '')) throw new Error(`${file}: "slug" inválido (use letras minúsculas, números e hífen).`);
  if (!Number.isInteger(position) || position < 1) throw new Error(`${file}: "position" precisa ser um número inteiro ≥ 1.`);
  if (!meta.title) throw new Error(`${file}: falta o "title".`);
  if (meta.summary && meta.summary.length > 300) throw new Error(`${file}: "summary" passa de 300 caracteres.`);

  return {
    slug: meta.slug,
    position,
    title: meta.title,
    summary: meta.summary || null,
    body_md: match[2].replace(/\r\n/g, '\n').trim(), // Windows (CRLF) → LF
    published: meta.published === 'true',
  };
}

async function loadChapters() {
  const files = (await readdir(CONTENT_DIR)).filter((f) => f.endsWith('.md')).sort();
  if (files.length === 0) throw new Error(`Nenhum .md encontrado em ${CONTENT_DIR}`);

  const chapters = [];
  for (const file of files) {
    chapters.push(parseChapter(file, await readFile(join(CONTENT_DIR, file), 'utf8')));
  }

  const dupe = (key) => chapters.find((c, i) => chapters.findIndex((o) => o[key] === c[key]) !== i);
  if (dupe('slug')) throw new Error(`Slug repetido: ${dupe('slug').slug}`);
  if (dupe('position')) throw new Error(`Posição repetida: ${dupe('position').position}`);
  return chapters;
}

async function main() {
  const chapters = await loadChapters();

  console.log(`📚 ${chapters.length} capítulos em ${CONTENT_DIR}`);
  for (const c of chapters) {
    console.log(`  ${String(c.position).padStart(2)}. ${c.slug.padEnd(12)} ${c.published ? 'publicado ' : 'rascunho  '} ${c.body_md.length} caracteres`);
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

  // Mantém a data de publicação original de quem já estava publicado
  const { data: existing, error: readErr } = await db.from('learn_chapters').select('slug, published_at');
  if (readErr) throw new Error(`Erro ao ler capítulos: ${readErr.message}`);
  const publishedAt = new Map((existing ?? []).map((r) => [r.slug, r.published_at]));
  const now = new Date().toISOString();

  const rows = chapters.map((c) => ({
    slug: c.slug,
    position: c.position,
    title: c.title,
    summary: c.summary,
    body_md: c.body_md,
    published_at: c.published ? (publishedAt.get(c.slug) ?? now) : null,
  }));

  // Duas passadas: posições temporárias primeiro, para trocar a ordem
  // de capítulos sem esbarrar na regra de "posição única".
  const temp = rows.map((r) => ({ ...r, position: r.position + 1000 }));
  for (const batch of [temp, rows]) {
    const { error } = await db.from('learn_chapters').upsert(batch, { onConflict: 'slug' });
    if (error) throw new Error(`Erro ao gravar: ${error.message}`);
  }

  const orphans = (existing ?? []).filter((r) => !chapters.some((c) => c.slug === r.slug));
  if (orphans.length) {
    console.warn(`\n⚠️  No banco, mas sem arquivo: ${orphans.map((o) => o.slug).join(', ')} (não foram alterados).`);
  }
  console.log('\n✅ Capítulos sincronizados.');
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
