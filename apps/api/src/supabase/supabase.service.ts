import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase com a chave service_role.
 * ⚠️ Essa chave ignora o RLS: ela existe SÓ aqui no back-end.
 * Nunca exponha em resposta de API, log ou no Angular.
 */
@Injectable()
export class SupabaseService {
  readonly db: SupabaseClient;

  constructor(config: ConfigService) {
    const url = config.getOrThrow<string>('SUPABASE_URL');
    const key = config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');
    this.db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
}
