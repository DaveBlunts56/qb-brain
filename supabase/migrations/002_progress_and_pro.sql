-- Upgrade for projects created from the v1.10 schema: run once in the Supabase SQL editor.
-- 1) allow the new "progress" document (session history, streaks, personal bests)
alter table public.player_data drop constraint if exists player_data_kind_check;
alter table public.player_data add constraint player_data_kind_check
  check (kind in ('settings','plays','tutorial','profile','progress'));

-- 2) QB Brain Pro entitlements (read-only for the app; written only by the payment webhook)
create table if not exists public.entitlements (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  plan                 text not null default 'free' check (plan in ('free','pro')),
  status               text not null default 'inactive' check (status in ('active','trialing','past_due','canceled','inactive')),
  provider             text,
  provider_customer_id text,
  current_period_end   timestamptz,
  updated_at           timestamptz not null default now()
);
alter table public.entitlements enable row level security;
drop policy if exists "read own entitlement" on public.entitlements;
create policy "read own entitlement" on public.entitlements for select to authenticated using (user_id = auth.uid());
