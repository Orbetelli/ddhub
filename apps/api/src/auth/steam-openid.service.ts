import { Injectable, Logger } from '@nestjs/common';

const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;
/** Campos que a Steam PRECISA ter assinado para a resposta valer. */
const REQUIRED_SIGNED = ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle'];
/** Resposta da Steam com mais de 5 minutos é recusada. */
const NONCE_MAX_AGE_MS = 5 * 60 * 1000;

export interface SteamProfile {
  steamId: string;
  name: string | null;
  avatar: string | null;
}

/**
 * Login com a Steam pelo OpenID 2.0 oficial (o mesmo de SteamDB, Faceit etc.).
 *
 * A senha da pessoa é digitada SÓ no site da Steam. O DDhub recebe de volta
 * apenas o SteamID64 e confere, direto com a Steam, que a resposta é verdadeira.
 *
 * Proteções:
 *  1. A resposta só vale se a Steam confirmar (check_authentication) — ninguém forja um SteamID.
 *  2. return_to tem que ser exatamente o nosso endereço (com o "state" daquele login).
 *  3. op_endpoint, claimed_id e identity conferidos campo a campo, e todos precisam vir assinados.
 *  4. Cada resposta (nonce) só pode ser usada uma vez e vale por 5 minutos.
 */
@Injectable()
export class SteamOpenIdService {
  private readonly logger = new Logger(SteamOpenIdService.name);
  private readonly usedNonces = new Map<string, number>();

  /** URL do site da Steam para onde mandamos a pessoa. */
  loginUrl(returnTo: string, realm: string): string {
    const params = new URLSearchParams({
      'openid.ns': OPENID_NS,
      'openid.mode': 'checkid_setup',
      'openid.return_to': returnTo,
      'openid.realm': realm,
      'openid.identity': IDENTIFIER_SELECT,
      'openid.claimed_id': IDENTIFIER_SELECT,
    });
    return `${STEAM_OPENID}?${params}`;
  }

  /**
   * Confere a volta da Steam. Devolve o SteamID64 ou lança erro.
   * @param query   parâmetros que chegaram no callback
   * @param expectedReturnTo  o return_to exato que mandamos (com o state)
   */
  async verify(query: Record<string, unknown>, expectedReturnTo: string): Promise<string> {
    const p: Record<string, string> = {};
    for (const [k, v] of Object.entries(query)) {
      if (k.startsWith('openid.') && typeof v === 'string') p[k] = v;
    }

    if (p['openid.mode'] !== 'id_res') throw new Error('login cancelado ou resposta inválida');
    if (p['openid.ns'] !== OPENID_NS) throw new Error('ns inválido');
    if (p['openid.op_endpoint'] !== STEAM_OPENID) throw new Error('op_endpoint inválido');
    if (p['openid.return_to'] !== expectedReturnTo) throw new Error('return_to não confere');

    const claimed = CLAIMED_ID.exec(p['openid.claimed_id'] ?? '');
    if (!claimed || p['openid.identity'] !== p['openid.claimed_id']) throw new Error('SteamID inválido');

    const signed = (p['openid.signed'] ?? '').split(',');
    if (!REQUIRED_SIGNED.every((f) => signed.includes(f))) throw new Error('campos sem assinatura');

    // Nonce: "2026-11-24T12:00:00Z<aleatório>" — só uma vez e recente
    const nonce = p['openid.response_nonce'] ?? '';
    const issued = Date.parse(nonce.slice(0, 20));
    if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > NONCE_MAX_AGE_MS) throw new Error('resposta expirada');
    this.cleanNonces();
    if (this.usedNonces.has(nonce)) throw new Error('resposta já usada');

    // A prova de verdade: perguntar à própria Steam se a assinatura é dela
    const body = new URLSearchParams({ ...p, 'openid.mode': 'check_authentication' });
    const res = await fetch(STEAM_OPENID, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'DDhub/0.1' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    if (!res.ok || !/^is_valid\s*:\s*true\s*$/m.test(text)) throw new Error('a Steam não confirmou o login');

    this.usedNonces.set(nonce, Date.now());
    return claimed[1];
  }

  /** Nick e avatar públicos (Steam Web API). Sem chave, segue só com o SteamID. */
  async profile(steamId: string): Promise<SteamProfile> {
    const key = process.env['STEAM_API_KEY'];
    if (!key) return { steamId, name: null, avatar: null };
    try {
      const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(key)}&steamids=${steamId}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { response?: { players?: { personaname?: string; avatarfull?: string }[] } };
      const player = json.response?.players?.[0];
      const avatar = player?.avatarfull && /^https:\/\//.test(player.avatarfull) ? player.avatarfull : null;
      return { steamId, name: player?.personaname?.trim() || null, avatar };
    } catch (err) {
      // Nunca logar a URL (ela tem a chave)
      this.logger.warn(`Perfil da Steam indisponível: ${err instanceof Error ? err.message : 'erro'}`);
      return { steamId, name: null, avatar: null };
    }
  }

  private cleanNonces(): void {
    const limit = Date.now() - 2 * NONCE_MAX_AGE_MS;
    for (const [n, at] of this.usedNonces) if (at < limit) this.usedNonces.delete(n);
  }
}
