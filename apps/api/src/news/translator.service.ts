import { Injectable, Logger } from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service.js';
import { steamToMarkdown } from './steam-markup.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
/** Modelo padrão; troque com GROQ_MODEL no .env sem mexer no código. */
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
/** Tamanho máximo de cada pedaço enviado (patches grandes vão em partes). */
const CHUNK_CHARS = 3500;
/**
 * Limite de tokens por minuto da conta do Groq (o gratuito do gpt-oss-120b é 8000).
 * Se mudar de plano ou de modelo, ajuste com GROQ_TPM no .env.
 */
const DEFAULT_TPM = 8000;
/** Quantas vezes tenta de novo quando o Groq responde 429 (limite). */
const MAX_RETRIES = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SYSTEM_PROMPT = `Você traduz notas de atualização do jogo Deadlock (Valve) do inglês para o português do Brasil.

Regras:
- Traduza o texto de forma natural, como um jogador brasileiro escreveria.
- NÃO traduza nomes do jogo: heróis, itens, habilidades, NPCs, objetivos e mecânicas com nome próprio (ex.: Walker, Patron, Guardian, Shrine, Mid Boss, Soul Urn, Spirit Power, Rejuvenator, Zipline). Mantenha exatamente como no original.
- Os nomes da lista "Termos do jogo" devem aparecer exatamente iguais.
- Mantenha números, porcentagens, unidades e a formatação Markdown (títulos ###, listas "- ", **negrito**, links) exatamente na mesma estrutura.
- Não acrescente, não resuma e não comente nada. Responda só com o texto traduzido.`;

/**
 * Traduz as notas de patch com o Groq (API compatível com OpenAI).
 * Chave em apps/api/.env: GROQ_API_KEY (e opcional GROQ_MODEL).
 */
@Injectable()
export class TranslatorService {
  private readonly logger = new Logger(TranslatorService.name);
  private terms: { at: number; list: string[] } | null = null;
  private warned = false;
  private running = false;
  /** Pedidos do último minuto: quando foram e quantos tokens (estimados) usaram. */
  private window: { at: number; tokens: number }[] = [];

  constructor(private readonly supabase: SupabaseService) {}

  get enabled(): boolean {
    return (process.env['GROQ_API_KEY'] ?? '').length > 0;
  }

  get model(): string {
    return process.env['GROQ_MODEL'] || DEFAULT_MODEL;
  }

  private get tpm(): number {
    return Number(process.env['GROQ_TPM']) || DEFAULT_TPM;
  }

  /** Traduz até `max` anúncios ainda sem tradução (mais recentes primeiro). */
  async translatePending(max = 3): Promise<number> {
    if (!this.enabled) {
      if (!this.warned) {
        this.logger.warn('Tradução desligada: defina GROQ_API_KEY no .env.');
        this.warned = true;
      }
      return 0;
    }
    // Um patch grande pode levar alguns minutos (por causa das pausas): não deixa rodar duas vezes junto
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.translateBatch(max);
    } finally {
      this.running = false;
    }
  }

  private async translateBatch(max: number): Promise<number> {
    const { data, error } = await this.supabase.db
      .from('patch_notes')
      .select('gid, title, body_raw')
      .is('translated_at', null)
      .order('published_at', { ascending: false })
      .limit(max);
    if (error) throw new Error(`patch_notes: ${error.message}`);

    let done = 0;
    for (const row of data ?? []) {
      try {
        const body = steamToMarkdown(row.body_raw ?? '');
        // Um pedido de cada vez, respeitando o limite de tokens por minuto
        const title = await this.translate(row.title);
        const bodyPt = await this.translateLong(body);
        const { error: upErr } = await this.supabase.db
          .from('patch_notes')
          .update({
            title_pt: title.trim().slice(0, 300),
            body_pt_md: bodyPt,
            translated_at: new Date().toISOString(),
            translation_model: this.model,
          })
          .eq('gid', row.gid);
        if (upErr) throw new Error(upErr.message);
        done++;
        this.logger.log(`Traduzido: ${row.title}`);
      } catch (err) {
        // Tenta de novo no próximo ciclo
        this.logger.warn(`Tradução de "${row.title}": ${String(err)}`);
        break;
      }
    }
    return done;
  }

  /** Textos longos vão em partes, cortando nos títulos ou entre parágrafos. */
  private async translateLong(markdown: string): Promise<string> {
    if (!markdown.trim()) return '';
    const parts: string[] = [];
    for (const chunk of chunkMarkdown(markdown, CHUNK_CHARS)) parts.push(await this.translate(chunk));
    return parts.join('\n\n');
  }

  private async translate(text: string): Promise<string> {
    if (!text.trim()) return text;
    const terms = (await this.gameTerms()).filter((t) => text.includes(t));
    const user = terms.length ? `Termos do jogo (não traduzir): ${terms.join(', ')}\n\n---\n\n${text}` : text;

    const body = JSON.stringify({
      model: this.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
    });
    // Estimativa: ~3,5 caracteres por token, entrada + saída (a tradução tem tamanho parecido)
    const estimate = Math.ceil((SYSTEM_PROMPT.length + user.length + text.length * 1.2) / 3.5);

    let res: Response | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.waitForBudget(estimate);
      res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env['GROQ_API_KEY']}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(90_000),
      });
      this.window.push({ at: Date.now(), tokens: estimate });
      if (res.status !== 429 || attempt === MAX_RETRIES) break;
      // Limite estourado mesmo assim: espera o tempo que o Groq pedir (ou 20 s) e tenta de novo
      const wait = Math.min(Number(res.headers.get('retry-after')) || 20, 90);
      this.logger.log(`Groq pediu uma pausa: esperando ${wait}s (tentativa ${attempt + 1}/${MAX_RETRIES}).`);
      await res.text();
      await sleep(wait * 1000);
    }
    if (!res || !res.ok) throw new Error(`Groq respondeu ${res?.status}: ${(await res?.text())?.slice(0, 200)}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const out = json.choices?.[0]?.message?.content?.trim();
    if (!out) throw new Error('Groq não devolveu texto.');
    return out;
  }

  /** Espera até caber mais `tokens` no limite de tokens por minuto (janela de 60 s). */
  private async waitForBudget(tokens: number): Promise<void> {
    const budget = this.tpm * 0.9; // folga de 10%
    for (;;) {
      const now = Date.now();
      this.window = this.window.filter((w) => now - w.at < 60_000);
      const used = this.window.reduce((sum, w) => sum + w.tokens, 0);
      if (used + tokens <= budget || this.window.length === 0) return;
      const wait = 60_000 - (now - this.window[0].at) + 250;
      await sleep(Math.max(wait, 500));
    }
  }

  /** Nomes em inglês de heróis, itens e habilidades (do nosso banco), em cache por 6 h. */
  private async gameTerms(): Promise<string[]> {
    if (this.terms && Date.now() - this.terms.at < 6 * 60 * 60 * 1000) return this.terms.list;
    const [heroes, items] = await Promise.all([
      this.supabase.db.from('heroes').select('name_en').eq('is_selectable', true),
      this.supabase.db.from('items').select('name_en').in('type', ['upgrade', 'ability']),
    ]);
    const names = [...(heroes.data ?? []), ...(items.data ?? [])]
      .map((r: { name_en: string | null }) => r.name_en?.trim())
      .filter((n): n is string => !!n && n.length > 2);
    const list = [...new Set(names)].sort((a, b) => b.length - a.length);
    this.terms = { at: Date.now(), list };
    return list;
  }
}

/** Corta o Markdown em pedaços de até `max` caracteres, preferindo cortar antes de títulos. */
export function chunkMarkdown(md: string, max: number): string[] {
  const blocks = md.split(/\n(?=### )|\n\n/);
  const chunks: string[] = [];
  let current = '';
  for (const block of blocks) {
    const sep = block.startsWith('### ') ? '\n' : '\n\n';
    if (current && (current + sep + block).length > max) {
      chunks.push(current);
      current = block;
    } else {
      current = current ? current + sep + block : block;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
