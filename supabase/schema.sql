-- QB Brain cloud schema (Supabase / Postgres). Run once in the Supabase SQL editor.
-- Model: the signed-in user is a parent/guardian/coach. Kids are rows in `players` under that user
-- (nickname + optional age group only). Training data is one JSON document per player per kind.
-- Row-level security means a signed-in user can only ever see and change their own players and data.

create table if not exists public.players (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nickname    text not null check (char_length(nickname) between 1 and 16),
  band        text check (band in ('8U','10U','12U','14U','HS','Adult')),
  created_at  timestamptz not null default now()
);
create index if not exists players_parent_idx on public.players(parent_id);

create table if not exists public.player_data (
  player_id   uuid not null references public.players(id) on delete cascade,
  kind        text not null check (kind in ('settings','plays','tutorial','profile','progress')),
  data        jsonb not null check (pg_column_size(data) < 1500000),
  upd         bigint not null,          -- last-changed time (ms) from the device, used for merging
  updated_at  timestamptz not null default now(),
  primary key (player_id, kind)
);

alter table public.players     enable row level security;
alter table public.player_data enable row level security;

drop policy if exists "own players" on public.players;
create policy "own players" on public.players
  for all to authenticated
  using (parent_id = auth.uid())
  with check (parent_id = auth.uid());

drop policy if exists "own players' data" on public.player_data;
create policy "own players' data" on public.player_data
  for all to authenticated
  using (exists (select 1 from public.players p where p.id = player_id and p.parent_id = auth.uid()))
  with check (exists (select 1 from public.players p where p.id = player_id and p.parent_id = auth.uid()));

-- at most 8 players per account
create or replace function public.players_limit() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.players where parent_id = new.parent_id) >= 8 then
    raise exception 'An account can have up to 8 players.';
  end if;
  return new;
end $$;
drop trigger if exists players_limit on public.players;
create trigger players_limit before insert on public.players for each row execute function public.players_limit();

-- keep updated_at honest
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists player_data_touch on public.player_data;
create trigger player_data_touch before update on public.player_data for each row execute function public.touch_updated_at();

-- "Delete account" in the app: removes the signed-in user; players and data go with it (on delete cascade).
create or replace function public.delete_my_account() returns void
  language sql security definer set search_path = public, auth as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- QB Brain Pro: who has it. The app can only READ its own row; nothing the app sends can grant Pro.
-- Rows are written by the server side only (a payment webhook running with the service-role key,
-- see supabase/functions/README.md). No row = Free.
create table if not exists public.entitlements (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  plan                 text not null default 'free' check (plan in ('free','pro')),
  status               text not null default 'inactive' check (status in ('active','trialing','past_due','canceled','inactive')),
  provider             text,                 -- e.g. 'stripe'
  provider_customer_id text,
  current_period_end   timestamptz,
  updated_at           timestamptz not null default now()
);
alter table public.entitlements enable row level security;
drop policy if exists "read own entitlement" on public.entitlements;
create policy "read own entitlement" on public.entitlements for select to authenticated using (user_id = auth.uid());
-- (deliberately no insert/update/delete policies for app users)
