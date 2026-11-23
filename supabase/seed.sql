-- =============================================================================
-- WS0 Task 0.20: Development seed data  (LOCAL / DEV ONLY - never run on production)
--
-- Creates two schools so tenant isolation can be seen and tested:
--   Wepluz Demo Academy (slug wepluz-demo) - one user per role
--   Greenfield College   (slug greenfield)  - a second, separate school
--
-- Everyone logs in with email + password:  Password123!
-- Demo parents also have phone numbers, so phone + SMS code login works once
-- Termii is connected. In demo mode they use email + password instead.
--
-- Later workstreams extend this file with classes (WS1), students (WS2), etc.
-- =============================================================================

create or replace function pg_temp.seed_user(
  p_id uuid, p_email text, p_phone text, p_full_name text
) returns void language plpgsql as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email,
    case when p_email is not null then extensions.crypt('Password123!', extensions.gen_salt('bf')) end,
    case when p_email is not null then now() end,
    p_phone,
    case when p_phone is not null then now() end,
    jsonb_build_object('provider', case when p_email is not null then 'email' else 'phone' end,
                       'providers', jsonb_build_array(case when p_email is not null then 'email' else 'phone' end)),
    jsonb_build_object('full_name', p_full_name),
    '', '', '', '', now(), now()
  ) on conflict (id) do nothing;

  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), p_id::text, p_id,
    case when p_email is not null
         then jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true)
         else jsonb_build_object('sub', p_id::text, 'phone', p_phone, 'phone_verified', true) end,
    case when p_email is not null then 'email' else 'phone' end,
    now(), now(), now()
  ) on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------- users
-- Platform (MANDEXA)
select pg_temp.seed_user('00000000-0000-0000-0000-0000000000a1', 'admin@mandexa.test', null, 'Platform Admin');
-- Wepluz Demo Academy
select pg_temp.seed_user('00000000-0000-0000-0000-0000000000b1', 'proprietor@demo.test', null, 'Adaeze Okafor');
select pg_temp.seed_user('00000000-0000-0000-0000-0000000000b2', 'principal@demo.test', null, 'Tunde Bakare');
select pg_temp.seed_user('00000000-0000-0000-0000-0000000000b3', 'admin@demo.test', null, 'Ngozi Eze');
select pg_temp.seed_user('00000000-0000-0000-0000-0000000000b4', 'bursar@demo.test', null, 'Ibrahim Musa');
select pg_temp.seed_user('00000000-0000-0000-0000-0000000000b5', 'teacher1@demo.test', null, 'Funmi Adeyemi');
select pg_temp.seed_user('00000000-0000-0000-0000-0000000000b6', 'teacher2@demo.test', null, 'Chinedu Obi');
select pg_temp.seed_user('00000000-0000-0000-0000-0000000000b7', 'parent1@demo.test', '2348030000001', 'Mrs Bisi Lawal');
select pg_temp.seed_user('00000000-0000-0000-0000-0000000000b8', 'parent2@demo.test', '2348030000002', 'Mr Emeka Nwosu');
-- Greenfield College
select pg_temp.seed_user('00000000-0000-0000-0000-0000000000c1', 'proprietor@greenfield.test', null, 'Halima Yusuf');
select pg_temp.seed_user('00000000-0000-0000-0000-0000000000c2', 'teacher@greenfield.test', null, 'Segun Ojo');

-- ---------------------------------------------------------------- schools
insert into public.schools (id, name, slug, short_code) values
  ('11111111-1111-1111-1111-111111111111', 'Wepluz Demo Academy', 'wepluz-demo', 'WPZ'),
  ('22222222-2222-2222-2222-222222222222', 'Greenfield College', 'greenfield', 'GFC')
on conflict (id) do nothing;

update public.school_settings
   set motto = 'Excellence and Character', address = '12 Admiralty Way, Lekki Phase 1',
       city = 'Lagos', state = 'Lagos', phone = '+2348012345678', email = 'info@demo.test'
 where school_id = '11111111-1111-1111-1111-111111111111';

update public.school_settings
   set motto = 'Knowledge is Light', city = 'Abuja', state = 'FCT',
       primary_color = '#1B4332', accent_color = '#B7791F'
 where school_id = '22222222-2222-2222-2222-222222222222';

-- ---------------------------------------------------------------- access
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1')
on conflict do nothing;

insert into public.school_memberships (school_id, user_id, role) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b1', 'proprietor'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b2', 'principal'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b3', 'school_admin'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b4', 'bursar'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b5', 'teacher'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b6', 'teacher'),
  -- Chinedu is a teacher AND a parent at the same school
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b6', 'parent'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b7', 'parent'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b8', 'parent'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000c1', 'proprietor'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000c2', 'teacher')
on conflict (school_id, user_id, role) do nothing;

-- =============================================================================
-- WS1: academic calendar and class structure for the demo
-- =============================================================================
insert into public.academic_sessions (id, school_id, name, start_date, end_date) values
  ('33333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026/2027', '2026-09-07', '2027-07-23'),
  ('33333333-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '2026/2027', '2026-09-14', '2027-07-16')
on conflict (id) do nothing;

insert into public.terms (id, school_id, session_id, term_number, name, start_date, end_date, next_term_begins) values
  ('33333333-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', '33333333-0000-0000-0000-000000000001', 1, 'First Term',  '2026-09-07', '2026-12-11', '2027-01-11'),
  ('33333333-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', '33333333-0000-0000-0000-000000000001', 2, 'Second Term', '2027-01-11', '2027-04-01', '2027-04-26'),
  ('33333333-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', '33333333-0000-0000-0000-000000000001', 3, 'Third Term',  '2027-04-26', '2027-07-23', null),
  ('33333333-0000-0000-0000-000000000021', '22222222-2222-2222-2222-222222222222', '33333333-0000-0000-0000-000000000002', 1, 'First Term',  '2026-09-14', '2026-12-18', '2027-01-11')
on conflict (id) do nothing;

select public.set_current_term('33333333-0000-0000-0000-000000000011');
select public.set_current_term('33333333-0000-0000-0000-000000000021');

select public.apply_nigerian_template('11111111-1111-1111-1111-111111111111', array['primary', 'junior_secondary', 'senior_secondary']);
select public.apply_nigerian_template('22222222-2222-2222-2222-222222222222', array['junior_secondary', 'senior_secondary']);

-- Arms: Primary has one arm (A); JSS and SS have A and B.
insert into public.class_arms (school_id, class_level_id, name, capacity)
select l.school_id, l.id, arm, 30
  from public.class_levels l
  cross join lateral unnest(case when l.section = 'primary' then array['A'] else array['A', 'B'] end) as arm
 where l.school_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')
on conflict do nothing;

-- Form tutors
update public.class_arms a set form_tutor_id = '00000000-0000-0000-0000-0000000000b5'
  from public.class_levels l where l.id = a.class_level_id and l.school_id = '11111111-1111-1111-1111-111111111111' and l.name = 'JSS 1' and a.name = 'A';
update public.class_arms a set form_tutor_id = '00000000-0000-0000-0000-0000000000b6'
  from public.class_levels l where l.id = a.class_level_id and l.school_id = '11111111-1111-1111-1111-111111111111' and l.name = 'JSS 1' and a.name = 'B';

-- Subject teachers for the current session
insert into public.teacher_assignments (school_id, session_id, class_arm_id, subject_id, teacher_id)
select '11111111-1111-1111-1111-111111111111', '33333333-0000-0000-0000-000000000001', a.id, s.id, t.teacher
  from (values
    ('JSS 1', 'A', 'Mathematics',    '00000000-0000-0000-0000-0000000000b5'::uuid),
    ('JSS 1', 'B', 'Mathematics',    '00000000-0000-0000-0000-0000000000b5'::uuid),
    ('JSS 2', 'A', 'Mathematics',    '00000000-0000-0000-0000-0000000000b5'::uuid),
    ('JSS 1', 'A', 'English Studies', '00000000-0000-0000-0000-0000000000b6'::uuid),
    ('JSS 1', 'B', 'English Studies', '00000000-0000-0000-0000-0000000000b6'::uuid),
    ('JSS 1', 'A', 'Basic Science',  '00000000-0000-0000-0000-0000000000b6'::uuid)
  ) as t(level_name, arm_name, subject_name, teacher)
  join public.class_levels l on l.school_id = '11111111-1111-1111-1111-111111111111' and l.name = t.level_name
  join public.class_arms a on a.class_level_id = l.id and a.name = t.arm_name
  join public.subjects s on s.school_id = '11111111-1111-1111-1111-111111111111' and s.name = t.subject_name
on conflict do nothing;
