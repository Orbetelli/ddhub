-- =====================================================================
-- DDhub — Builds da comunidade (as tabelas já existem desde o schema inicial)
--
-- Tudo é gravado só pela API (chave secreta), que confere quem está logado.
-- Quem votou em qual build não é público: a API devolve só a soma (score).
-- =====================================================================

revoke insert, update, delete on public.builds, public.build_items, public.build_votes from anon, authenticated;

drop policy if exists "leitura pública" on public.build_votes;
revoke select on public.build_votes from anon, authenticated;

-- Listagens: mais votadas e mais novas
create index if not exists builds_published_score_idx on public.builds (score desc, updated_at desc) where is_published;
create index if not exists builds_published_new_idx on public.builds (updated_at desc) where is_published;
create index if not exists build_votes_user_idx on public.build_votes (user_id);

notify pgrst, 'reload schema';
