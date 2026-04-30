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
    new.email,
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

insert into public.profiles (id, email, full_name)
select
  u.id,
  u.email,
  coalesce(
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    nullif(u.raw_user_meta_data ->> 'name', '')
  ) as full_name
from auth.users u
on conflict (id) do update
set
  email = excluded.email,
  full_name = coalesce(excluded.full_name, public.profiles.full_name),
  updated_at = now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_documents_created_by_auth_users'
  ) then
    alter table public.documents
      add constraint fk_documents_created_by_auth_users
      foreign key (created_by) references auth.users(id) on delete restrict not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'fk_document_versions_uploaded_by_auth_users'
  ) then
    alter table public.document_versions
      add constraint fk_document_versions_uploaded_by_auth_users
      foreign key (uploaded_by) references auth.users(id) on delete restrict not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'fk_document_approvals_reviewer_id_auth_users'
  ) then
    alter table public.document_approvals
      add constraint fk_document_approvals_reviewer_id_auth_users
      foreign key (reviewer_id) references auth.users(id) on delete restrict not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'fk_audit_logs_actor_id_auth_users'
  ) then
    alter table public.audit_logs
      add constraint fk_audit_logs_actor_id_auth_users
      foreign key (actor_id) references auth.users(id) on delete set null not valid;
  end if;
end
$$;

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
