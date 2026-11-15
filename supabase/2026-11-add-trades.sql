-- Contract Connect: let each account save the trades it sells.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
alter table public.profiles add column if not exists trades text[] not null default '{}';
grant update (areas, trades) on public.profiles to authenticated;
