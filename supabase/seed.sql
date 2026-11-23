-- =============================================================================
-- WS0 Task 0.20: Development seed data  (LOCAL / DEV ONLY - never run on production)
--
-- Creates two schools so tenant isolation can be seen and tested:
--   Wepluz Demo Academy (slug wepluz-demo) - one user per role
--   Greenfield College   (slug greenfield)  - a second, separate school
--
-- All staff log in with email + password:  Password123!
-- Parents log in with phone + OTP (in local dev, read the OTP from Supabase logs).
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
select pg_temp.seed_user('00000000-0000-0000-0000-0000000000b7', null, '2348030000001', 'Mrs Bisi Lawal');
select pg_temp.seed_user('00000000-0000-0000-0000-0000000000b8', null, '2348030000002', 'Mr Emeka Nwosu');
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
