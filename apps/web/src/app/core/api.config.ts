import { InjectionToken } from '@angular/core';

/** Endereço da API do DDhub (NestJS). Troque aqui quando for pra produção. */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => 'http://localhost:3000',
});