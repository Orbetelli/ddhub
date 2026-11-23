-- =====================================================================
-- DDhub — sessões de login (Steam, e depois Discord)
--
-- O site guarda só um token aleatório num cookie httpOnly. Aqui fica apenas o
-- HASH (SHA-256) desse token: mesmo quem lesse esta tabela não conseguiria
-- usar as sessões. Sair da conta = apagar a linha.
-- =====================================================================

create table public.user_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  provider      public.identity_provider not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  last_seen_at  timestamptz not null default now()
);
create index on public.user_sessions (user_id);
create index on public.user_sessions (expires_at);

-- RLS ligado e NENHUMA policy: ninguém lê sessões pela chave pública, só a API.
alter table public.user_sessions enable row level security;
revoke all on public.user_sessions from anon, authenticated;

-- Usuários e identidades só são gravados pela API (chave secreta)
revoke insert, update, delete on public.users, public.user_identities from anon, authenticated;

-- A leitura pública de perfis não precisa expor tudo: tira o acesso ao papel e ao banimento
-- (a API continua lendo tudo pela chave secreta).
revoke select on public.users from anon, authenticated;
grant select (id, username, display_name, avatar_url, bio, created_at, deleted_at) on public.users to anon, authenticated;
