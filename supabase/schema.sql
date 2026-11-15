-- Contract Connect database setup.
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Safe to run again: it only creates what is missing and replaces the policies and functions.
--
-- How access works:
--   * Every signed-up user gets a row in profiles (created automatically).
--   * profiles.areas is the list of towns and boroughs the user turned on, e.g. {'wc:Yonkers','nyc:Brooklyn'}.
--   * profiles.has_access is the paywall switch. It defaults to true (everyone gets full access until payments exist).
--     Users cannot change it themselves; later a payment webhook will set it.
--   * A user can read a project, or a town's contacts, only if has_access is true and that area is in their list.
--   * The daily GitHub job uploads data with the secret key, which bypasses these rules.

-- Profiles ---------------------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text,
  areas       text[] not null default '{}',
  has_access  boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Users may change only their area list, never has_access, email or id.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (areas) on public.profiles to authenticated;

-- Create the profile when someone signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Access check used by the data policies ---------------------------------------------------------
create or replace function public.can_see(a text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.has_access and a = any (p.areas)
  );
$$;
revoke all on function public.can_see(text) from public, anon;
grant execute on function public.can_see(text) to authenticated;

-- Projects: one row per Westchester referral or NYC filing ----------------------------------------
create table if not exists public.projects (
  region      text not null,             -- 'wc' or 'nyc'
  id          text not null,             -- county file id or DOB job number
  area        text not null,             -- 'wc:<town>' or 'nyc:<borough>'
  payload     jsonb not null,            -- the row as the page expects it, plus its extras
  run         text not null default '',  -- upload run id; rows from older runs are deleted
  primary key (region, id)
);
create index if not exists projects_area_idx on public.projects (area);
alter table public.projects enable row level security;

drop policy if exists "see projects in your areas" on public.projects;
create policy "see projects in your areas" on public.projects
  for select to authenticated using (public.can_see(area));

-- Area info: town contacts, keyed by area ---------------------------------------------------------
create table if not exists public.area_info (
  area     text primary key,
  payload  jsonb not null,
  run      text not null default ''
);
alter table public.area_info enable row level security;

drop policy if exists "see info for your areas" on public.area_info;
create policy "see info for your areas" on public.area_info
  for select to authenticated using (public.can_see(area));

-- Meta: pull dates and the list of areas with project counts (no names or contacts) ----------------
create table if not exists public.meta (
  key      text primary key,
  payload  jsonb not null
);
alter table public.meta enable row level security;

drop policy if exists "signed-in users read meta" on public.meta;
create policy "signed-in users read meta" on public.meta
  for select to authenticated using (true);

revoke all on public.projects, public.area_info, public.meta from anon, authenticated;
grant select on public.projects, public.area_info, public.meta to authenticated;

-- The daily upload (secret key = service_role) writes the data. Granted explicitly because new tables are not
-- exposed automatically in this project.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.projects, public.area_info, public.meta to service_role;
grant select, insert, update, delete on public.profiles to service_role;
