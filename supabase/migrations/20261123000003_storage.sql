-- =============================================================================
-- WS0 Task 0.18: Storage for school logos and branding
-- Bucket "school-assets" is public-read (logos appear on login pages and report
-- cards). Files live under a folder named after the school id:
--   school-assets/{school_id}/logo-1732350000.webp
-- Only that school's admins may upload, replace or delete files in its folder.
-- Private documents (student records etc.) will use a separate private bucket.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('school-assets', 'school-assets', true, 2097152,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Safely read the school id from the first folder of an object path.
create or replace function public.storage_school_id(p_object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_first text := split_part(p_object_name, '/', 1);
begin
  if v_first ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v_first::uuid;
  end if;
  return null;
end;
$$;
grant execute on function public.storage_school_id(text) to authenticated;

create policy "School admins can read their asset folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'school-assets' and public.is_school_admin(public.storage_school_id(name)));

create policy "School admins can upload to their asset folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'school-assets' and public.is_school_admin(public.storage_school_id(name)));

create policy "School admins can replace files in their asset folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'school-assets' and public.is_school_admin(public.storage_school_id(name)))
  with check (bucket_id = 'school-assets' and public.is_school_admin(public.storage_school_id(name)));

create policy "School admins can delete files in their asset folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'school-assets' and public.is_school_admin(public.storage_school_id(name)));
