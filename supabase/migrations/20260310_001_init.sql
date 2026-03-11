create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'document_status'
  ) then
    create type document_status as enum (
      'draft',
      'in_review',
      'approved',
      'rejected',
      'archived'
    );
  end if;
end
$$;

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category_id uuid references categories(id) on delete set null,
  status document_status not null default 'draft',
  current_version integer not null default 1,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  version_number integer not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  change_summary text,
  uploaded_by uuid not null,
  created_at timestamptz not null default now(),
  unique (document_id, version_number)
);

create table if not exists approval_steps (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references categories(id) on delete cascade,
  step_order integer not null,
  role_name text not null,
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (category_id, step_order)
);

create table if not exists document_approvals (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  step_id uuid references approval_steps(id) on delete set null,
  reviewer_id uuid not null,
  decision document_status not null,
  comments text,
  reviewed_at timestamptz not null default now(),
  check (decision in ('in_review', 'approved', 'rejected'))
);

create table if not exists audit_logs (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  actor_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_documents_status on documents(status);
create index if not exists idx_documents_category_id on documents(category_id);
create index if not exists idx_documents_updated_at on documents(updated_at desc);
create index if not exists idx_document_versions_document_id on document_versions(document_id);
create index if not exists idx_document_approvals_document_id on document_approvals(document_id);
create index if not exists idx_audit_logs_entity on audit_logs(entity_type, entity_id);
create index if not exists idx_audit_logs_created_at on audit_logs(created_at desc);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_documents_set_updated_at on documents;
create trigger trg_documents_set_updated_at
before update on documents
for each row
execute function set_updated_at();

create or replace function write_audit_log()
returns trigger
language plpgsql
as $$
declare
  actor uuid;
  old_payload jsonb;
  new_payload jsonb;
  entity uuid;
begin
  if tg_op = 'INSERT' then
    new_payload := to_jsonb(new);
    actor := coalesce(
      (nullif(new_payload ->> 'created_by', ''))::uuid,
      (nullif(new_payload ->> 'uploaded_by', ''))::uuid,
      (nullif(new_payload ->> 'reviewer_id', ''))::uuid
    );
    entity := (nullif(new_payload ->> 'id', ''))::uuid;

    insert into audit_logs (entity_type, entity_id, action, actor_id, new_data)
    values (tg_table_name, entity, 'insert', actor, new_payload);

    return new;
  elsif tg_op = 'UPDATE' then
    old_payload := to_jsonb(old);
    new_payload := to_jsonb(new);
    actor := coalesce(
      (nullif(new_payload ->> 'created_by', ''))::uuid,
      (nullif(new_payload ->> 'uploaded_by', ''))::uuid,
      (nullif(new_payload ->> 'reviewer_id', ''))::uuid
    );
    entity := (nullif(new_payload ->> 'id', ''))::uuid;

    insert into audit_logs (entity_type, entity_id, action, actor_id, old_data, new_data)
    values (tg_table_name, entity, 'update', actor, old_payload, new_payload);

    return new;
  elsif tg_op = 'DELETE' then
    old_payload := to_jsonb(old);
    actor := coalesce(
      (nullif(old_payload ->> 'created_by', ''))::uuid,
      (nullif(old_payload ->> 'uploaded_by', ''))::uuid,
      (nullif(old_payload ->> 'reviewer_id', ''))::uuid
    );
    entity := (nullif(old_payload ->> 'id', ''))::uuid;

    insert into audit_logs (entity_type, entity_id, action, actor_id, old_data)
    values (tg_table_name, entity, 'delete', actor, old_payload);

    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_documents_audit on documents;
create trigger trg_documents_audit
after insert or update or delete on documents
for each row
execute function write_audit_log();

drop trigger if exists trg_document_versions_audit on document_versions;
create trigger trg_document_versions_audit
after insert or update or delete on document_versions
for each row
execute function write_audit_log();

drop trigger if exists trg_document_approvals_audit on document_approvals;
create trigger trg_document_approvals_audit
after insert or update or delete on document_approvals
for each row
execute function write_audit_log();

insert into categories (name, description)
values
  ('Administrativo', 'Documentos administrativos y oficios'),
  ('Finanzas', 'Comprobantes y documentos contables'),
  ('Recursos Humanos', 'Expedientes y formatos internos')
on conflict (name) do nothing;

