-- =============================================================================
-- WS0 Task 0.14: Audit log
-- Records who changed what, when, and the before/after values.
-- Rows can be read by school leadership but never edited or deleted through the API.
-- To audit a new table later:  select public.enable_audit('public.my_table');
-- =============================================================================

create table public.audit_log (
  id              bigint generated always as identity primary key,
  school_id       uuid references public.schools (id) on delete cascade,
  table_name      text not null,
  record_id       text,
  action          text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data        jsonb,
  new_data        jsonb,
  changed_fields  text[],
  actor_id        uuid,
  actor_role      text,
  occurred_at     timestamptz not null default now()
);

create index audit_log_school_time_idx on public.audit_log (school_id, occurred_at desc);
create index audit_log_record_idx on public.audit_log (table_name, record_id);

create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new     jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row     jsonb := coalesce(v_new, v_old);
  v_changed text[];
  v_school  uuid;
  v_record  text;
  v_claims  jsonb;
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key)
      into v_changed
      from jsonb_each(v_new) n
     where n.key <> 'updated_at'
       and n.value is distinct from (v_old -> n.key);
    if v_changed is null then
      return new;  -- nothing meaningful changed
    end if;
  end if;

  -- Work out which school the row belongs to.
  if tg_table_name = 'schools' then
    v_school := (v_row ->> 'id')::uuid;
  elsif v_row ? 'school_id' then
    v_school := (v_row ->> 'school_id')::uuid;
  end if;

  v_record := coalesce(v_row ->> 'id', v_row ->> 'school_id', v_row ->> 'user_id');

  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null;
  end;

  insert into public.audit_log
    (school_id, table_name, record_id, action, old_data, new_data, changed_fields, actor_id, actor_role)
  values
    (v_school, tg_table_name, v_record, tg_op, v_old, v_new, v_changed,
     (select auth.uid()), coalesce(v_claims ->> 'role', 'system'));

  return coalesce(new, old);
end;
$$;

-- Helper to switch auditing on for any table.
create or replace function public.enable_audit(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('drop trigger if exists audit_changes on %s', p_table);
  execute format(
    'create trigger audit_changes after insert or update or delete on %s
       for each row execute function public.audit_trigger()', p_table);
end;
$$;

select public.enable_audit('public.schools');
select public.enable_audit('public.school_settings');
select public.enable_audit('public.school_memberships');
select public.enable_audit('public.platform_admins');

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

create policy "Leadership can read their school's audit log" on public.audit_log
  for select to authenticated
  using (
    public.is_platform_admin()
    or (school_id is not null
        and public.has_school_role(school_id, array['proprietor', 'principal']::public.app_role[]))
  );

revoke execute on function public.audit_trigger(), public.enable_audit(regclass) from public, anon, authenticated;
