-- Storage policies for document uploads.
-- The frontend writes files to:
-- organizations/{organization_id}/{user_id}/{timestamp}-{file_name}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documentos',
  'documentos',
  false,
  52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.is_organization_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.can_write_organization_documents(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'member')
  );
$$;

create or replace function public.storage_document_organization_id(p_name text)
returns uuid
language plpgsql
stable
as $$
declare
  parts text[];
begin
  parts := storage.foldername(p_name);

  if array_length(parts, 1) < 2 then
    return null;
  end if;

  if parts[1] <> 'organizations' then
    return null;
  end if;

  if parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  return parts[2]::uuid;
end;
$$;

drop policy if exists document_storage_select_org_members on storage.objects;
create policy document_storage_select_org_members
on storage.objects
for select
to authenticated
using (
  bucket_id = 'documentos'
  and (storage.foldername(name))[1] = 'organizations'
  and public.is_organization_member(public.storage_document_organization_id(name))
);

drop policy if exists document_storage_insert_org_writers on storage.objects;
create policy document_storage_insert_org_writers
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'documentos'
  and (storage.foldername(name))[1] = 'organizations'
  and (storage.foldername(name))[3] = auth.uid()::text
  and public.can_write_organization_documents(public.storage_document_organization_id(name))
);

drop policy if exists document_storage_update_org_writers on storage.objects;
create policy document_storage_update_org_writers
on storage.objects
for update
to authenticated
using (
  bucket_id = 'documentos'
  and public.can_write_organization_documents(public.storage_document_organization_id(name))
)
with check (
  bucket_id = 'documentos'
  and (storage.foldername(name))[1] = 'organizations'
  and (storage.foldername(name))[3] = auth.uid()::text
  and public.can_write_organization_documents(public.storage_document_organization_id(name))
);

drop policy if exists document_storage_delete_org_writers on storage.objects;
create policy document_storage_delete_org_writers
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'documentos'
  and public.can_write_organization_documents(public.storage_document_organization_id(name))
);
