-- =====================================================================
-- DDhub — Cena: torneios, classificação e partidas
--
-- Torneios vêm de content/cena/torneios/*.md pelo "npm run content:sync".
-- Se o arquivo tiver "startgg:", as partidas e a classificação podem vir do start.gg.
-- Partidas aceitam times sem cadastro (seleções, times de fora): só o nome.
-- =====================================================================

alter table public.tournaments
  add column bio_md        text not null default '' check (char_length(bio_md) <= 6000),
  add column teams_count   smallint check (teams_count is null or teams_count >= 0),
  add column startgg_slug  text,
  add column logo_url      text check (logo_url is null or logo_url ~ '^https://');

-- Classificação final (1º, 2º, 3º-4º...). Time cadastrado ou só o nome.
create table public.tournament_placements (
  tournament_id  uuid not null references public.tournaments(id) on delete cascade,
  position       smallint not null check (position >= 1),   -- ordem na tabela
  place          text not null check (char_length(place) <= 12),  -- "1", "3-4", "5-8"
  team_id        uuid references public.teams(id) on delete set null,
  team_name      text not null check (char_length(team_name) between 1 and 60),
  prize_usd      numeric(12,2) check (prize_usd is null or prize_usd >= 0),
  primary key (tournament_id, position)
);

-- Partidas com times sem cadastro: guarda o nome
alter table public.matches
  alter column team1_id drop not null,
  alter column team2_id drop not null,
  add column team1_name   text check (team1_name is null or char_length(team1_name) between 1 and 60),
  add column team2_name   text check (team2_name is null or char_length(team2_name) between 1 and 60),
  add column source       text not null default 'content' check (source in ('content', 'startgg')),
  add column external_id  text unique,
  add constraint matches_team1_present check (team1_id is not null or team1_name is not null),
  add constraint matches_team2_present check (team2_id is not null or team2_name is not null);

create index on public.matches (tournament_id);

alter table public.tournament_placements enable row level security;
create policy "leitura pública" on public.tournament_placements for select using (true);

-- Escrita só pela API / content:sync (chave secreta)
revoke insert, update, delete on public.tournaments, public.tournament_placements, public.matches from anon, authenticated;
