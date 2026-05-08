-- Keep audit rows tenant-scoped after the multi-organization migration.
-- Safe to run multiple times from Supabase SQL Editor.

create or replace function public.write_audit_log()
returns trigger
language plpgsql
as $$
declare
  actor uuid;
  old_payload jsonb;
  new_payload jsonb;
  entity uuid;
  org uuid;
begin
  if tg_op = 'INSERT' then
    new_payload := to_jsonb(new);
    actor := coalesce(
      (nullif(new_payload ->> 'created_by', ''))::uuid,
      (nullif(new_payload ->> 'uploaded_by', ''))::uuid,
      (nullif(new_payload ->> 'reviewer_id', ''))::uuid
    );
    entity := (nullif(new_payload ->> 'id', ''))::uuid;
    org := (nullif(new_payload ->> 'organization_id', ''))::uuid;

    insert into public.audit_logs (organization_id, entity_type, entity_id, action, actor_id, new_data)
    values (org, tg_table_name, entity, 'insert', actor, new_payload);

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
    org := coalesce(
      (nullif(new_payload ->> 'organization_id', ''))::uuid,
      (nullif(old_payload ->> 'organization_id', ''))::uuid
    );

    insert into public.audit_logs (organization_id, entity_type, entity_id, action, actor_id, old_data, new_data)
    values (org, tg_table_name, entity, 'update', actor, old_payload, new_payload);

    return new;
  elsif tg_op = 'DELETE' then
    old_payload := to_jsonb(old);
    actor := coalesce(
      (nullif(old_payload ->> 'created_by', ''))::uuid,
      (nullif(old_payload ->> 'uploaded_by', ''))::uuid,
      (nullif(old_payload ->> 'reviewer_id', ''))::uuid
    );
    entity := (nullif(old_payload ->> 'id', ''))::uuid;
    org := (nullif(old_payload ->> 'organization_id', ''))::uuid;

    insert into public.audit_logs (organization_id, entity_type, entity_id, action, actor_id, old_data)
    values (org, tg_table_name, entity, 'delete', actor, old_payload);

    return old;
  end if;

  return null;
end;
$$;
