-- =============================================================================
-- WS0 foundations: security and tenancy tests.
-- Run with tests/db/run.sh. Any failed assertion stops the run with a message.
-- Each scenario runs in a transaction that is rolled back, so tests do not
-- affect each other.
-- =============================================================================

\echo '--- 1. Seed and triggers'
select tests.eq((select count(*) from public.profiles), 11::bigint, 'a profile is created for every auth user');
select tests.eq((select phone from public.profiles where id = :parent), '+2348030000001', 'auth phone is stored in +234 format');
select tests.eq((select email from public.profiles where id = :teacher), 'teacher1@demo.test', 'email mirrored to profile');
select tests.eq((select full_name from public.profiles where id = :teacher), 'Funmi Adeyemi', 'name copied from sign-up metadata');
select tests.eq((select count(*) from public.school_settings), 2::bigint, 'settings row auto-created per school');
select tests.eq(public.normalize_phone('08031234567'), '+2348031234567', 'normalize 080... number');
select tests.eq(public.normalize_phone('+234 803 123 4567'), '+2348031234567', 'normalize spaced +234 number');
select tests.eq(public.normalize_phone('2348031234567'), '+2348031234567', 'normalize 234... number');
select tests.eq(public.normalize_phone('  '), null::text, 'blank phone becomes null');

begin;
update auth.users set phone = '2348099999999' where id = :parent;
select tests.eq((select phone from public.profiles where id = :parent), '+2348099999999', 'phone change in auth syncs to profile');
rollback;

\echo '--- 2. Anonymous visitors'
begin;
set local role anon;
select tests.fails('select * from public.schools', 'anon cannot read schools', 'permission denied');
select tests.fails('select * from public.profiles', 'anon cannot read profiles', 'permission denied');
select tests.eq((select count(*) from public.get_school_branding('wepluz-demo')), 1::bigint, 'anon can read public branding by slug');
select tests.eq((select count(*) from public.get_school_branding('nope')), 0::bigint, 'unknown slug returns nothing');
rollback;

\echo '--- 3. Teacher'
begin;
select tests.login(:teacher);
set local role authenticated;
select tests.eq((select count(*) from public.schools), 1::bigint, 'teacher sees only own school');
select tests.eq((select count(*) from public.profiles), 6::bigint, 'teacher sees staff profiles in own school');
select tests.eq((select count(*) from public.profiles where id in (:parent, '00000000-0000-0000-0000-0000000000b8')), 0::bigint, 'teacher cannot see parent profiles (yet)');
select tests.eq((select count(*) from public.school_memberships), 1::bigint, 'teacher sees only own membership');
select tests.eq((select count(*) from public.school_settings where school_id = :s2), 0::bigint, 'teacher cannot see other school settings');
select tests.eq(tests.rows($$update public.school_settings set motto = 'x'$$), 0, 'teacher cannot edit school settings');
select tests.eq((select count(*) from public.audit_log), 0::bigint, 'teacher cannot read audit log');
select tests.eq(tests.rows($$update public.profiles set full_name = 'Funmi A.' where id = auth.uid()$$), 1, 'teacher can edit own name');
select tests.fails($$update public.profiles set email = 'x@y.z' where id = auth.uid()$$, 'teacher cannot edit own email directly', 'permission denied');
select tests.fails(format('update public.profiles set active_school_id = %L where id = auth.uid()', :s2), 'teacher cannot switch to a school they do not belong to', 'not a member');
select tests.fails(format($$insert into public.school_memberships (school_id, user_id, role) values (%L, auth.uid(), 'proprietor')$$, :s1), 'teacher cannot grant themselves a role', 'permission denied');
select tests.eq(tests.rows($$update public.school_memberships set role = 'proprietor' where user_id = auth.uid()$$), 0, 'teacher cannot change own role');
select tests.eq(public.current_school_id(), :s1::uuid, 'current_school_id resolves to teacher''s school');
select tests.eq(public.is_school_staff(:s1), true, 'teacher counts as staff');
select tests.eq(public.is_school_admin(:s1), false, 'teacher is not an admin');
rollback;

\echo '--- 4. School admin'
begin;
select tests.login(:sadmin);
set local role authenticated;
select tests.eq((select count(*) from public.school_memberships), 9::bigint, 'admin sees all memberships in own school');
select tests.eq((select count(*) from public.profiles where id in (:gf_prop)), 0::bigint, 'admin cannot see other school''s people');
select tests.eq((select count(*) from public.profiles), 8::bigint, 'admin sees profiles of own school members');
select tests.eq(tests.rows($$update public.school_settings set motto = 'New motto'$$), 1, 'admin can edit own school settings only');
select tests.eq(tests.rows($$update public.schools set name = 'Wepluz Academy'$$), 1, 'admin can rename own school');
select tests.fails($$update public.schools set slug = 'hijack'$$, 'admin cannot change the school slug', 'permission denied');
select tests.eq(tests.rows(format($$update public.school_memberships set role = 'bursar' where user_id = %L$$, :teacher)), 1, 'admin can change a teacher''s role');
select tests.eq(tests.rows(format($$update public.school_memberships set status = 'suspended' where user_id = %L$$, :principal)), 0, 'admin cannot touch the principal');
select tests.fails(format($$update public.school_memberships set role = 'proprietor' where user_id = %L and role = 'teacher'$$, :dual), 'admin cannot promote anyone to proprietor', 'row-level security');
select tests.eq(tests.rows($$update public.school_memberships set status = 'suspended' where user_id = auth.uid()$$), 0, 'admin cannot modify own membership');
select tests.eq((select count(*) from public.audit_log), 0::bigint, 'school_admin cannot read audit log (leadership only)');
select tests.eq(tests.rows(format($$insert into storage.objects (bucket_id, name) values ('school-assets', %L)$$, '11111111-1111-1111-1111-111111111111/logo.webp')), 1, 'admin can upload to own school folder');
select tests.fails(format($$insert into storage.objects (bucket_id, name) values ('school-assets', %L)$$, '22222222-2222-2222-2222-222222222222/logo.webp'), 'admin cannot upload to another school folder', 'row-level security');
select tests.fails($$insert into storage.objects (bucket_id, name) values ('school-assets', 'not-a-uuid/logo.webp')$$, 'upload outside a school folder is blocked', 'row-level security');
rollback;

\echo '--- 5. Audit trail'
begin;
select tests.login(:sadmin);
set local role authenticated;
update public.school_settings set motto = 'Audited motto' where school_id = :s1;
reset role;
select tests.eq((select actor_id from public.audit_log where table_name = 'school_settings' order by id desc limit 1), :sadmin::uuid, 'audit records who made the change');
select tests.eq((select changed_fields from public.audit_log where table_name = 'school_settings' order by id desc limit 1), array['motto'], 'audit records which field changed');
select tests.eq((select new_data ->> 'motto' from public.audit_log where table_name = 'school_settings' order by id desc limit 1), 'Audited motto', 'audit records the new value');
select tests.eq((select school_id from public.audit_log where table_name = 'school_settings' order by id desc limit 1), :s1::uuid, 'audit entry is tagged with the school');
select tests.login(:proprietor);
set local role authenticated;
select tests.eq((select count(*) > 0 from public.audit_log where school_id = :s1), true, 'proprietor can read own school audit log');
select tests.eq((select count(*) from public.audit_log where school_id = :s2), 0::bigint, 'proprietor cannot read other school audit log');
select tests.fails('delete from public.audit_log', 'nobody can delete audit entries', 'permission denied');
select tests.fails($$update public.audit_log set action = 'INSERT'$$, 'nobody can edit audit entries', 'permission denied');
rollback;

\echo '--- 6. Proprietor and last-proprietor protection'
begin;
select tests.login(:proprietor);
set local role authenticated;
select tests.eq(tests.rows(format($$update public.school_memberships set status = 'suspended' where user_id = %L$$, :principal)), 1, 'proprietor can suspend the principal');
select tests.eq(tests.rows($$update public.school_memberships set status = 'suspended' where user_id = auth.uid()$$), 0, 'proprietor cannot suspend themselves');
rollback;

begin;
select tests.login(:platform);
set local role authenticated;
select tests.fails(format($$update public.school_memberships set status = 'suspended' where user_id = %L$$, :proprietor), 'last active proprietor cannot be removed', 'at least one active proprietor');
rollback;

\echo '--- 7. Cross-tenant isolation'
begin;
select tests.login(:gf_prop);
set local role authenticated;
select tests.eq((select name from public.schools), 'Greenfield College', 'Greenfield proprietor sees only Greenfield');
select tests.eq((select count(*) from public.school_memberships), 2::bigint, 'sees only Greenfield memberships');
select tests.eq(tests.rows(format($$update public.school_settings set motto = 'x' where school_id = %L$$, :s1)), 0, 'cannot edit another school''s settings');
select tests.eq((select count(*) from public.profiles where id = :teacher), 0::bigint, 'cannot see another school''s teacher');
rollback;

\echo '--- 8. Dual role, parent, platform admin, suspended school'
begin;
select tests.login(:dual);
set local role authenticated;
select tests.eq(public.has_school_role(:s1, array['teacher']::public.app_role[]), true, 'dual-role user is a teacher');
select tests.eq(public.has_school_role(:s1, array['parent']::public.app_role[]), true, 'dual-role user is also a parent');
select tests.login(:parent);
select tests.eq(public.is_school_staff(:s1), false, 'parent is not staff');
select tests.eq((select count(*) from public.school_memberships), 1::bigint, 'parent sees only own membership');
select tests.login(:platform);
select tests.eq((select count(*) from public.schools), 2::bigint, 'platform admin sees all schools');
rollback;

begin;
update public.schools set status = 'suspended' where id = :s2;
select tests.login(:gf_prop);
set local role authenticated;
select tests.eq((select count(*) from public.schools), 0::bigint, 'members lose access when their school is suspended');
rollback;

