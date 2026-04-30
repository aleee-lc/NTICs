-- Hardening for profiles/auth integration.
-- Safe to run multiple times from Supabase SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  role text not null default 'user' check (role in ('user', 'reviewer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_email on public.profiles(email);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.normalize_profile_email()
returns trigger
language plpgsql
as $$
begin
  if new.email is not null then
    new.email := nullif(lower(trim(new.email)), '');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_normalize_email on public.profiles;
create trigger trg_profiles_normalize_email
before insert or update of email on public.profiles
for each row
execute function public.normalize_profile_email();

drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(new.email),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', '')
    )
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_auth_users_sync_profile on auth.users;
create trigger trg_auth_users_sync_profile
after insert or update of email, raw_user_meta_data on auth.users
for each row
execute function public.sync_profile_from_auth_user();

create or replace function public.backfill_profiles_from_auth_users()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_rows integer := 0;
begin
  insert into public.profiles (id, email, full_name)
  select
    u.id,
    lower(u.email),
    coalesce(
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(u.raw_user_meta_data ->> 'name', '')
    )
  from auth.users u
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    updated_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

select public.backfill_profiles_from_auth_users();

create or replace view public.auth_user_diagnostics as
select
  u.id,
  u.email,
  (u.email_confirmed_at is not null) as email_confirmed,
  (u.encrypted_password is not null) as has_password,
  (p.id is not null) as has_profile,
  p.role as profile_role,
  u.created_at,
  u.last_sign_in_at
from auth.users u
left join public.profiles p on p.id = u.id;

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

