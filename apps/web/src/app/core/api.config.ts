import { InjectionToken, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';

/**
 * Endereço da API em produção (Render), sem a barra no final.
 */
export const PROD_API_URL = 'https://ddhub-api.onrender.com';

const LOCAL_API_URL = 'http://localhost:3000';

/** Endereço da API do DDhub: local no seu PC, produção no site publicado. */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => {
    const host = inject(DOCUMENT).location?.hostname ?? 'localhost';
    return host === 'localhost' || host === '127.0.0.1' ? LOCAL_API_URL : PROD_API_URL;
  },
});
