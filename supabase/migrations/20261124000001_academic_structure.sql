-- =============================================================================
-- WS1 Academic structure: sessions, terms, class levels, arms, subjects,
-- class-subject offerings and teacher assignments.  Tasks 1.01 - 1.10, 1.15
--
-- Tenant safety: every child row repeats school_id and references its parent
-- with a composite (id, school_id) foreign key, so a row can never point at a
-- parent that belongs to a different school, whatever the app sends.
-- Deletes are blocked (NO ACTION): you cannot delete a session that has terms, a class
-- level that has arms, etc. This protects records once students and scores exist.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1.01 Academic sessions
-- ---------------------------------------------------------------------------
create table public.academic_sessions (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  name        text not null check (name ~ '^[0-9]{4}/[0-9]{4}$'),
  start_date  date not null,
  end_date    date not null,
  is_current  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (school_id, name),
  unique (id, school_id),
  check (end_date > start_date),
  check (end_date - start_date <= 400)
);
comment on column public.academic_sessions.name is 'e.g. 2026/2027';

-- 1.03 only one current session per school
create unique index academic_sessions_one_current on public.academic_sessions (school_id) where is_current;

-- ---------------------------------------------------------------------------
-- 1.02 Terms
-- ---------------------------------------------------------------------------
create table public.terms (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null,
  session_id        uuid not null,
  term_number       smallint not null check (term_number between 1 and 3),
  name              text not null check (length(btrim(name)) between 2 and 50),
  start_date        date not null,
  end_date          date not null,
  next_term_begins  date,
  is_current        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (session_id, school_id) references public.academic_sessions (id, school_id) on delete no action,
  foreign key (school_id) references public.schools (id) on delete cascade,
  unique (session_id, term_number),
  unique (id, school_id),
  check (end_date > start_date),
  check (next_term_begins is null or next_term_begins > end_date)
);
create unique index terms_one_current on public.terms (school_id) where is_current;
create index terms_session_idx on public.terms (session_id);

-- Term dates must sit inside the session, and terms must not overlap.
create or replace function public.check_term_dates()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  s record;
begin
  select start_date, end_date into s from public.academic_sessions where id = new.session_id;
  if new.start_date < s.start_date or new.end_date > s.end_date then
    raise exception 'Term dates must fall within the session (% to %)', s.start_date, s.end_date
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.terms t
     where t.session_id = new.session_id
       and t.id <> new.id
       and daterange(t.start_date, t.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
  ) then
    raise exception 'Term dates overlap another term in this session' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger terms_check_dates before insert or update of start_date, end_date, session_id on public.terms
  for each row execute function public.check_term_dates();

-- A session's dates cannot be changed so that an existing term falls outside them.
create or replace function public.check_session_dates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.terms t
     where t.session_id = new.id
       and (t.start_date < new.start_date or t.end_date > new.end_date)
  ) then
    raise exception 'A term in this session falls outside the new dates. Adjust the term first.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger academic_sessions_check_dates before update of start_date, end_date on public.academic_sessions
  for each row execute function public.check_session_dates();

-- ---------------------------------------------------------------------------
-- 1.04 Switch the current term (and its session) safely in one transaction
-- ---------------------------------------------------------------------------
create or replace function public.set_current_term(p_term_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid;
  v_session uuid;
begin
  select school_id, session_id into v_school, v_session from public.terms where id = p_term_id;
  if v_school is null then
    raise exception 'Term not found' using errcode = 'P0002';
  end if;
  -- Signed-in users must be admins; seed scripts / service role (no user) are trusted.
  if (select auth.uid()) is not null and not public.is_school_admin(v_school) then
    raise exception 'Only school administrators can change the current term' using errcode = '42501';
  end if;

  update public.terms set is_current = false where school_id = v_school and is_current and id <> p_term_id;
  update public.academic_sessions set is_current = false where school_id = v_school and is_current and id <> v_session;
  update public.academic_sessions set is_current = true where id = v_session and not is_current;
  update public.terms set is_current = true where id = p_term_id and not is_current;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.05 Class levels  (e.g. Primary 1, JSS 1, SS 2)
-- ---------------------------------------------------------------------------
create table public.class_levels (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 50),
  section      text not null check (section in ('nursery', 'primary', 'junior_secondary', 'senior_secondary')),
  order_index  integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, school_id)
);
create unique index class_levels_unique_name on public.class_levels (school_id, lower(name));
create index class_levels_order_idx on public.class_levels (school_id, order_index);

-- ---------------------------------------------------------------------------
-- 1.06 Class arms  (e.g. JSS 1 Gold, JSS 1 A)
-- ---------------------------------------------------------------------------
create table public.class_arms (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null,
  class_level_id  uuid not null,
  name            text not null check (length(btrim(name)) between 1 and 30),
  form_tutor_id   uuid references public.profiles (id) on delete set null,
  capacity        integer check (capacity is null or capacity between 1 and 200),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (class_level_id, school_id) references public.class_levels (id, school_id) on delete no action,
  foreign key (school_id) references public.schools (id) on delete cascade,
  unique (id, school_id)
);
create unique index class_arms_unique_name on public.class_arms (class_level_id, lower(name));
create index class_arms_tutor_idx on public.class_arms (form_tutor_id);

-- ---------------------------------------------------------------------------
-- 1.07 Subjects
-- ---------------------------------------------------------------------------
create table public.subjects (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 2 and 100),
  short_code  text not null check (short_code ~ '^[A-Z0-9]{2,8}$'),
  category    text not null default 'core'
              check (category in ('core', 'science', 'arts', 'commercial', 'trade', 'language', 'religious', 'vocational', 'early_years', 'other')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (school_id, short_code),
  unique (id, school_id)
);
create unique index subjects_unique_name on public.subjects (school_id, lower(name));

-- ---------------------------------------------------------------------------
-- 1.08 Which subjects each class level offers
-- ---------------------------------------------------------------------------
create table public.class_subjects (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools (id) on delete cascade,
  class_level_id  uuid not null,
  subject_id      uuid not null,
  is_compulsory   boolean not null default true,
  created_at      timestamptz not null default now(),
  foreign key (class_level_id, school_id) references public.class_levels (id, school_id) on delete no action,
  foreign key (subject_id, school_id) references public.subjects (id, school_id) on delete no action,
  unique (class_level_id, subject_id)
);
create index class_subjects_subject_idx on public.class_subjects (subject_id);

-- ---------------------------------------------------------------------------
-- 1.09 Who teaches which subject to which arm, per session
-- ---------------------------------------------------------------------------
create table public.teacher_assignments (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools (id) on delete cascade,
  session_id    uuid not null,
  class_arm_id  uuid not null,
  subject_id    uuid not null,
  teacher_id    uuid not null references public.profiles (id) on delete no action,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (session_id, school_id) references public.academic_sessions (id, school_id) on delete no action,
  foreign key (class_arm_id, school_id) references public.class_arms (id, school_id) on delete no action,
  foreign key (subject_id, school_id) references public.subjects (id, school_id) on delete no action,
  unique (session_id, class_arm_id, subject_id)
);
create index teacher_assignments_teacher_idx on public.teacher_assignments (teacher_id, session_id);

-- Form tutors and subject teachers must be active staff of the same school
-- (teacher or leadership); subject must be offered at the arm's level.
create or replace function public.is_teaching_staff(p_school_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.school_memberships m
     where m.school_id = p_school_id
       and m.user_id = p_user_id
       and m.status = 'active'
       and m.role in ('teacher', 'principal', 'school_admin', 'proprietor')
  );
$$;

create or replace function public.check_form_tutor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.form_tutor_id is not null and not public.is_teaching_staff(new.school_id, new.form_tutor_id) then
    raise exception 'The form tutor must be a teacher at this school' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger class_arms_check_tutor before insert or update of form_tutor_id on public.class_arms
  for each row execute function public.check_form_tutor();

create or replace function public.check_teacher_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_teaching_staff(new.school_id, new.teacher_id) then
    raise exception 'The teacher must be a teacher at this school' using errcode = '23514';
  end if;
  if not exists (
    select 1
      from public.class_arms a
      join public.class_subjects cs on cs.class_level_id = a.class_level_id
     where a.id = new.class_arm_id and cs.subject_id = new.subject_id
  ) then
    raise exception 'This subject is not offered in this class. Add it under Subjects first.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger teacher_assignments_check before insert or update on public.teacher_assignments
  for each row execute function public.check_teacher_assignment();

-- Removing a subject from a class level is blocked while teachers are assigned to it.
create or replace function public.check_class_subject_removal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.schools s where s.id = old.school_id)  -- not part of deleting the school
     and exists (
    select 1
      from public.teacher_assignments ta
      join public.class_arms a on a.id = ta.class_arm_id
     where a.class_level_id = old.class_level_id and ta.subject_id = old.subject_id
  ) then
    raise exception 'Teachers are assigned to this subject in this class. Remove those assignments first.' using errcode = '23503';
  end if;
  return old;
end;
$$;

create trigger class_subjects_check_removal before delete on public.class_subjects
  for each row execute function public.check_class_subject_removal();

-- ---------------------------------------------------------------------------
-- updated_at + audit
-- ---------------------------------------------------------------------------
create trigger academic_sessions_set_updated_at before update on public.academic_sessions for each row execute function public.set_updated_at();
create trigger terms_set_updated_at before update on public.terms for each row execute function public.set_updated_at();
create trigger class_levels_set_updated_at before update on public.class_levels for each row execute function public.set_updated_at();
create trigger class_arms_set_updated_at before update on public.class_arms for each row execute function public.set_updated_at();
create trigger subjects_set_updated_at before update on public.subjects for each row execute function public.set_updated_at();
create trigger teacher_assignments_set_updated_at before update on public.teacher_assignments for each row execute function public.set_updated_at();

select public.enable_audit('public.academic_sessions');
select public.enable_audit('public.terms');
select public.enable_audit('public.class_levels');
select public.enable_audit('public.class_arms');
select public.enable_audit('public.subjects');
select public.enable_audit('public.class_subjects');
select public.enable_audit('public.teacher_assignments');

-- ---------------------------------------------------------------------------
-- 1.10 Row-level security
-- Everyone in the school (including parents) may read the calendar and class
-- structure; teacher assignments are staff-only. Only administrators write.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['academic_sessions', 'terms', 'class_levels', 'class_arms', 'subjects', 'class_subjects'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format($p$create policy "Members can view" on public.%I for select to authenticated
                     using (public.is_school_member(school_id))$p$, t);
    execute format($p$create policy "Admins can add" on public.%I for insert to authenticated
                     with check (public.is_school_admin(school_id))$p$, t);
    execute format($p$create policy "Admins can edit" on public.%I for update to authenticated
                     using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id))$p$, t);
    execute format($p$create policy "Admins can delete" on public.%I for delete to authenticated
                     using (public.is_school_admin(school_id))$p$, t);
  end loop;
end;
$$;

-- "Current" flags change only through set_current_term(), never directly.
revoke update on public.academic_sessions, public.terms from authenticated;
grant update (name, start_date, end_date) on public.academic_sessions to authenticated;
grant update (name, start_date, end_date, next_term_begins) on public.terms to authenticated;
revoke insert on public.academic_sessions, public.terms from authenticated;
grant insert (school_id, name, start_date, end_date) on public.academic_sessions to authenticated;
grant insert (school_id, session_id, term_number, name, start_date, end_date, next_term_begins) on public.terms to authenticated;

alter table public.teacher_assignments enable row level security;
revoke all on public.teacher_assignments from anon;
create policy "Staff can view assignments" on public.teacher_assignments
  for select to authenticated using (public.is_school_staff(school_id));
create policy "Admins can add assignments" on public.teacher_assignments
  for insert to authenticated with check (public.is_school_admin(school_id));
create policy "Admins can edit assignments" on public.teacher_assignments
  for update to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "Admins can delete assignments" on public.teacher_assignments
  for delete to authenticated using (public.is_school_admin(school_id));

-- Teachers need to see colleagues' names on timetables and class lists.
create or replace function public.can_view_profile(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id = (select auth.uid())
      or public.is_platform_admin()
      or exists (
        select 1
          from public.school_memberships theirs
         where theirs.user_id = p_user_id
           and (
             public.is_school_admin(theirs.school_id)
             -- staff can see other staff (not parents) in their school
             or (theirs.role <> 'parent' and public.is_school_staff(theirs.school_id))
           )
      );
$$;

-- ---------------------------------------------------------------------------
-- 1.15 Nigerian starter template
-- Creates class levels and a common subject list for the chosen sections.
-- Safe to run more than once (skips anything that already exists).
-- Schools should edit the result to match their own curriculum.
-- ---------------------------------------------------------------------------
create or replace function public.apply_nigerian_template(p_school_id uuid, p_sections text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_levels jsonb := jsonb_build_object(
    'nursery',          jsonb_build_array('Creche', 'Nursery 1', 'Nursery 2'),
    'primary',          jsonb_build_array('Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6'),
    'junior_secondary', jsonb_build_array('JSS 1', 'JSS 2', 'JSS 3'),
    'senior_secondary', jsonb_build_array('SS 1', 'SS 2', 'SS 3'));
  v_order jsonb := jsonb_build_object('nursery', 0, 'primary', 100, 'junior_secondary', 200, 'senior_secondary', 300);
  -- [name, code, category, compulsory]
  v_subjects jsonb := jsonb_build_object(
    'nursery', jsonb_build_array(
      jsonb_build_array('Literacy', 'LIT', 'early_years', true),
      jsonb_build_array('Numeracy', 'NUM', 'early_years', true),
      jsonb_build_array('Phonics', 'PHON', 'early_years', true),
      jsonb_build_array('Basic Science', 'BSC', 'science', true),
      jsonb_build_array('Social Habits', 'SOCH', 'early_years', true),
      jsonb_build_array('Health Habits', 'HLTH', 'early_years', true),
      jsonb_build_array('Creative Arts', 'CART', 'early_years', true),
      jsonb_build_array('Rhymes and Songs', 'RHYM', 'early_years', true),
      jsonb_build_array('Handwriting', 'HWR', 'early_years', true)),
    'primary', jsonb_build_array(
      jsonb_build_array('English Studies', 'ENG', 'core', true),
      jsonb_build_array('Mathematics', 'MTH', 'core', true),
      jsonb_build_array('Basic Science and Technology', 'BST', 'science', true),
      jsonb_build_array('Social Studies', 'SOS', 'core', true),
      jsonb_build_array('Civic Education', 'CVE', 'core', true),
      jsonb_build_array('History', 'HIS', 'arts', true),
      jsonb_build_array('Christian Religious Studies', 'CRS', 'religious', false),
      jsonb_build_array('Islamic Religious Studies', 'IRS', 'religious', false),
      jsonb_build_array('Cultural and Creative Arts', 'CCA', 'arts', true),
      jsonb_build_array('Nigerian Language', 'NGL', 'language', true),
      jsonb_build_array('French', 'FRE', 'language', true),
      jsonb_build_array('Physical and Health Education', 'PHE', 'core', true),
      jsonb_build_array('Computer Studies', 'CMP', 'core', true),
      jsonb_build_array('Pre-Vocational Studies', 'PVS', 'vocational', true),
      jsonb_build_array('Verbal Reasoning', 'VR', 'core', true),
      jsonb_build_array('Quantitative Reasoning', 'QR', 'core', true)),
    'junior_secondary', jsonb_build_array(
      jsonb_build_array('English Studies', 'ENG', 'core', true),
      jsonb_build_array('Mathematics', 'MTH', 'core', true),
      jsonb_build_array('Basic Science', 'BSC', 'science', true),
      jsonb_build_array('Basic Technology', 'BTE', 'science', true),
      jsonb_build_array('Social Studies', 'SOS', 'core', true),
      jsonb_build_array('Civic Education', 'CVE', 'core', true),
      jsonb_build_array('History', 'HIS', 'arts', true),
      jsonb_build_array('Christian Religious Studies', 'CRS', 'religious', false),
      jsonb_build_array('Islamic Religious Studies', 'IRS', 'religious', false),
      jsonb_build_array('Cultural and Creative Arts', 'CCA', 'arts', true),
      jsonb_build_array('Nigerian Language', 'NGL', 'language', true),
      jsonb_build_array('French', 'FRE', 'language', true),
      jsonb_build_array('Physical and Health Education', 'PHE', 'core', true),
      jsonb_build_array('Computer Studies', 'CMP', 'core', true),
      jsonb_build_array('Agricultural Science', 'AGR', 'vocational', true),
      jsonb_build_array('Home Economics', 'HEC', 'vocational', true),
      jsonb_build_array('Business Studies', 'BUS', 'commercial', true)),
    'senior_secondary', jsonb_build_array(
      jsonb_build_array('English Language', 'ENGL', 'core', true),
      jsonb_build_array('General Mathematics', 'GMTH', 'core', true),
      jsonb_build_array('Civic Education', 'CVE', 'core', true),
      jsonb_build_array('Data Processing', 'DP', 'trade', true),
      jsonb_build_array('Biology', 'BIO', 'science', false),
      jsonb_build_array('Chemistry', 'CHE', 'science', false),
      jsonb_build_array('Physics', 'PHY', 'science', false),
      jsonb_build_array('Further Mathematics', 'FMTH', 'science', false),
      jsonb_build_array('Agricultural Science', 'AGR', 'vocational', false),
      jsonb_build_array('Geography', 'GEO', 'arts', false),
      jsonb_build_array('Technical Drawing', 'TD', 'science', false),
      jsonb_build_array('Literature in English', 'LIT2', 'arts', false),
      jsonb_build_array('Government', 'GOV', 'arts', false),
      jsonb_build_array('History', 'HIS', 'arts', false),
      jsonb_build_array('Christian Religious Studies', 'CRS', 'religious', false),
      jsonb_build_array('Islamic Religious Studies', 'IRS', 'religious', false),
      jsonb_build_array('Nigerian Language', 'NGL', 'language', false),
      jsonb_build_array('French', 'FRE', 'language', false),
      jsonb_build_array('Economics', 'ECO', 'commercial', false),
      jsonb_build_array('Financial Accounting', 'ACC', 'commercial', false),
      jsonb_build_array('Commerce', 'COM', 'commercial', false),
      jsonb_build_array('Marketing', 'MKT', 'trade', false)));
  v_section text;
  v_name text;
  v_idx integer;
  v_level_id uuid;
  v_subject jsonb;
  v_subject_id uuid;
  v_levels_added integer := 0;
  v_subjects_added integer := 0;
  v_links_added integer := 0;
  v_rows integer;
begin
  -- Signed-in users must be admins of the school. (Seed scripts and the
  -- service role run without a user and are trusted.)
  if (select auth.uid()) is not null and not public.is_school_admin(p_school_id) then
    raise exception 'Only school administrators can apply the template' using errcode = '42501';
  end if;
  if p_sections is null or cardinality(p_sections) = 0 then
    raise exception 'Choose at least one section' using errcode = '22023';
  end if;

  foreach v_section in array p_sections loop
    if not v_levels ? v_section then
      raise exception 'Unknown section: %', v_section using errcode = '22023';
    end if;

    -- Subjects for this section
    for v_subject in select * from jsonb_array_elements(v_subjects -> v_section) loop
      insert into public.subjects (school_id, name, short_code, category)
      values (p_school_id, v_subject ->> 0, v_subject ->> 1, v_subject ->> 2)
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      v_subjects_added := v_subjects_added + v_rows;
    end loop;

    -- Levels and their subject offerings
    v_idx := 0;
    for v_name in select jsonb_array_elements_text(v_levels -> v_section) loop
      v_idx := v_idx + 1;
      insert into public.class_levels (school_id, name, section, order_index)
      values (p_school_id, v_name, v_section, (v_order ->> v_section)::int + v_idx)
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      v_levels_added := v_levels_added + v_rows;

      select id into v_level_id from public.class_levels
       where school_id = p_school_id and lower(name) = lower(v_name);

      for v_subject in select * from jsonb_array_elements(v_subjects -> v_section) loop
        select id into v_subject_id from public.subjects
         where school_id = p_school_id and lower(name) = lower(v_subject ->> 0);
        if v_subject_id is not null then
          insert into public.class_subjects (school_id, class_level_id, subject_id, is_compulsory)
          values (p_school_id, v_level_id, v_subject_id, (v_subject ->> 3)::boolean)
          on conflict do nothing;
          get diagnostics v_rows = row_count;
          v_links_added := v_links_added + v_rows;
        end if;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('levels_added', v_levels_added, 'subjects_added', v_subjects_added, 'offerings_added', v_links_added);
end;
$$;

revoke execute on function public.set_current_term(uuid), public.apply_nigerian_template(uuid, text[]),
  public.is_teaching_staff(uuid, uuid), public.check_term_dates(), public.check_session_dates(),
  public.check_form_tutor(), public.check_teacher_assignment(), public.check_class_subject_removal()
  from public, anon;
grant execute on function public.set_current_term(uuid), public.apply_nigerian_template(uuid, text[]),
  public.is_teaching_staff(uuid, uuid) to authenticated;
