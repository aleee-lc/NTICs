-- Multi-organization (multi-tenant) foundation for PaperHub.
-- Safe to run multiple times from Supabase SQL Editor.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists idx_organization_memberships_user_id
  on public.organization_memberships(user_id);

create index if not exists idx_organizations_created_at
  on public.organizations(created_at desc);

do $$
declare
  v_default_org uuid;
begin
  insert into public.organizations (name, slug)
  values ('Mi organizacion', 'mi-organizacion')
  on conflict (slug) do update
  set name = excluded.name
  returning id into v_default_org;

  if v_default_org is null then
    select id into v_default_org
    from public.organizations
    where slug = 'mi-organizacion'
    limit 1;
  end if;

  alter table public.categories add column if not exists organization_id uuid;
  alter table public.documents add column if not exists organization_id uuid;
  alter table public.approval_steps add column if not exists organization_id uuid;
  alter table public.document_versions add column if not exists organization_id uuid;
  alter table public.document_approvals add column if not exists organization_id uuid;
  alter table public.audit_logs add column if not exists organization_id uuid;

  update public.categories
  set organization_id = v_default_org
  where organization_id is null;

  update public.documents
  set organization_id = v_default_org
  where organization_id is null;

  update public.approval_steps s
  set organization_id = coalesce(c.organization_id, v_default_org)
  from public.categories c
  where s.category_id = c.id
    and s.organization_id is null;

  update public.approval_steps
  set organization_id = v_default_org
  where organization_id is null;

  update public.document_versions dv
  set organization_id = coalesce(d.organization_id, v_default_org)
  from public.documents d
  where dv.document_id = d.id
    and dv.organization_id is null;

  update public.document_versions
  set organization_id = v_default_org
  where organization_id is null;

  update public.document_approvals da
  set organization_id = coalesce(d.organization_id, v_default_org)
  from public.documents d
  where da.document_id = d.id
    and da.organization_id is null;

  update public.document_approvals
  set organization_id = v_default_org
  where organization_id is null;

  update public.audit_logs l
  set organization_id = coalesce(
    case
      when l.entity_type = 'documents' then (
        select d.organization_id from public.documents d where d.id = l.entity_id
      )
      when l.entity_type = 'document_versions' then (
        select dv.organization_id from public.document_versions dv where dv.id = l.entity_id
      )
      when l.entity_type = 'document_approvals' then (
        select da.organization_id from public.document_approvals da where da.id = l.entity_id
      )
      when l.entity_type = 'categories' then (
        select c.organization_id from public.categories c where c.id = l.entity_id
      )
      when l.entity_type = 'approval_steps' then (
        select s.organization_id from public.approval_steps s where s.id = l.entity_id
      )
      else null
    end,
    v_default_org
  )
  where l.organization_id is null;

  alter table public.categories alter column organization_id set not null;
  alter table public.documents alter column organization_id set not null;
  alter table public.approval_steps alter column organization_id set not null;
  alter table public.document_versions alter column organization_id set not null;
  alter table public.document_approvals alter column organization_id set not null;
  alter table public.audit_logs alter column organization_id set not null;

  if not exists (
    select 1 from pg_constraint where conname = 'fk_categories_organization'
  ) then
    alter table public.categories
      add constraint fk_categories_organization
      foreign key (organization_id) references public.organizations(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'fk_documents_organization'
  ) then
    alter table public.documents
      add constraint fk_documents_organization
      foreign key (organization_id) references public.organizations(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'fk_approval_steps_organization'
  ) then
    alter table public.approval_steps
      add constraint fk_approval_steps_organization
      foreign key (organization_id) references public.organizations(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'fk_document_versions_organization'
  ) then
    alter table public.document_versions
      add constraint fk_document_versions_organization
      foreign key (organization_id) references public.organizations(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'fk_document_approvals_organization'
  ) then
    alter table public.document_approvals
      add constraint fk_document_approvals_organization
      foreign key (organization_id) references public.organizations(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'fk_audit_logs_organization'
  ) then
    alter table public.audit_logs
      add constraint fk_audit_logs_organization
      foreign key (organization_id) references public.organizations(id) on delete cascade;
  end if;

  if exists (
    select 1 from pg_constraint where conname = 'categories_name_key'
  ) then
    alter table public.categories drop constraint categories_name_key;
  end if;

  create unique index if not exists uq_categories_org_name
    on public.categories (organization_id, lower(name));

  create index if not exists idx_categories_org_created_at
    on public.categories(organization_id, created_at desc);

  create index if not exists idx_categories_org_name
    on public.categories(organization_id, name);

  create index if not exists idx_documents_org_created_at
    on public.documents(organization_id, created_at desc);

  create index if not exists idx_documents_org_updated_at
    on public.documents(organization_id, updated_at desc);

  create index if not exists idx_document_versions_org_document
    on public.document_versions(organization_id, document_id);

  create index if not exists idx_document_approvals_org_document
    on public.document_approvals(organization_id, document_id);

  create index if not exists idx_audit_logs_org_created_at
    on public.audit_logs(organization_id, created_at desc);

  insert into public.organization_memberships (organization_id, user_id, role)
  select
    v_default_org,
    p.id,
    case
      when p.role = 'admin' then 'admin'
      when p.role = 'reviewer' then 'member'
      else 'member'
    end
  from public.profiles p
  on conflict (organization_id, user_id) do nothing;

  insert into public.organization_memberships (organization_id, user_id, role)
  select
    v_default_org,
    u.id,
    'member'
  from auth.users u
  on conflict (organization_id, user_id) do nothing;

  update public.organization_memberships m
  set role = 'owner'
  where m.organization_id = v_default_org
    and m.user_id = (
      select u.id
      from auth.users u
      order by u.created_at asc
      limit 1
    )
    and exists (select 1 from auth.users);
end
$$;
