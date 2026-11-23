-- =============================================================================
-- WS1 academic structure: data rules and security tests.
-- =============================================================================

\echo '--- WS1-1. Seeded demo structure'
select tests.eq((select count(*) from public.class_levels where school_id = :s1), 12::bigint, 'demo school has Primary 1-6, JSS 1-3, SS 1-3');
select tests.eq((select count(*) from public.class_arms a join public.class_levels l on l.id = a.class_level_id where l.school_id = :s1 and l.name = 'JSS 1'), 2::bigint, 'JSS 1 has two arms');
select tests.eq((select is_current from public.terms where id = :term1), true, 'first term is current');
select tests.eq((select count(*) from public.terms where school_id = :s1 and is_current), 1::bigint, 'exactly one current term');
select tests.eq((select count(*) from public.teacher_assignments where school_id = :s1), 6::bigint, 'demo teacher assignments loaded');
select tests.eq((select count(*) > 15 from public.subjects where school_id = :s1), true, 'template created subjects');

\echo '--- WS1-2. Reading the structure'
begin;
select tests.login(:teacher);
set local role authenticated;
select tests.eq((select count(*) from public.class_levels), 12::bigint, 'teacher sees own school levels only');
select tests.eq((select count(*) from public.teacher_assignments where teacher_id = auth.uid()), 3::bigint, 'teacher sees own assignments (My classes)');
select tests.eq((select count(*) > 3 from public.teacher_assignments), true, 'teacher sees colleagues'' assignments');
select tests.login(:parent);
select tests.eq((select count(*) from public.class_levels), 12::bigint, 'parent can read class names');
select tests.eq((select count(*) from public.terms where is_current), 1::bigint, 'parent can read the current term');
select tests.eq((select count(*) from public.teacher_assignments), 0::bigint, 'parent cannot read teacher assignments');
select tests.login(:gf_prop);
select tests.eq((select count(*) from public.class_levels where school_id = :s1), 0::bigint, 'other school cannot see our classes');
select tests.eq((select count(*) from public.terms where school_id = :s1), 0::bigint, 'other school cannot see our terms');
rollback;

\echo '--- WS1-3. Who can change the structure'
begin;
select tests.login(:teacher);
set local role authenticated;
select tests.fails(format($$insert into public.class_levels (school_id, name, section) values (%L, 'JSS 4', 'junior_secondary')$$, :s1), 'teacher cannot add a class level', 'row-level security');
select tests.eq(tests.rows($$update public.subjects set name = 'Maths' where name = 'Mathematics'$$), 0, 'teacher cannot rename subjects');
select tests.fails(format('select public.set_current_term(%L)', :term2), 'teacher cannot change the current term', 'only school administrators');
select tests.fails(format($$select public.apply_nigerian_template(%L, array['nursery'])$$, :s1), 'teacher cannot apply the template', 'only school administrators');
rollback;

begin;
select tests.login(:sadmin);
set local role authenticated;
select tests.eq(tests.rows(format($$insert into public.class_levels (school_id, name, section, order_index) values (%L, 'Year 7', 'junior_secondary', 250)$$, :s1)), 1, 'admin can add a class level');
select tests.fails(format($$insert into public.class_levels (school_id, name, section) values (%L, 'jss 1', 'junior_secondary')$$, :s1), 'class names are unique per school (any capitalisation)', 'duplicate');
select tests.fails(format($$insert into public.class_levels (school_id, name, section) values (%L, 'Hijack', 'primary')$$, :s2), 'admin cannot add classes to another school', 'row-level security');
select tests.eq(tests.rows($$update public.subjects set name = 'Maths' where name = 'Mathematics'$$), 1, 'admin can rename a subject');
rollback;

\echo '--- WS1-4. Sessions and terms'
begin;
select tests.login(:sadmin);
set local role authenticated;
select tests.eq(tests.rows(format($$insert into public.academic_sessions (school_id, name, start_date, end_date) values (%L, '2027/2028', '2027-09-06', '2028-07-21')$$, :s1)), 1, 'admin can create a session');
select tests.fails(format($$insert into public.academic_sessions (school_id, name, start_date, end_date) values (%L, '2028-2029', '2028-09-06', '2029-07-21')$$, :s1), 'session name must look like 2028/2029', 'check constraint');
select tests.fails(format($$insert into public.academic_sessions (school_id, name, start_date, end_date, is_current) values (%L, '2029/2030', '2029-09-06', '2030-07-21', true)$$, :s1), 'cannot set current flag directly', 'permission denied');
select tests.fails(format($$update public.terms set is_current = true where id = %L$$, :term2), 'cannot flip current term directly', 'permission denied');
select tests.fails(format($$insert into public.terms (school_id, session_id, term_number, name, start_date, end_date) values (%L, %L, 1, 'Bad', '2026-08-01', '2026-12-01')$$, :s1, :session1), 'term must sit inside its session', 'within the session');
select tests.fails(format($$update public.terms set start_date = '2026-12-01' where id = %L$$, :term2), 'terms cannot overlap', 'overlap');
select tests.fails(format($$insert into public.terms (school_id, session_id, term_number, name, start_date, end_date) values (%L, %L, 2, 'Sneaky', '2027-01-11', '2027-03-01')$$, :s1, :session2), 'term cannot attach to another school''s session', 'foreign key');
select tests.fails(format($$update public.academic_sessions set end_date = '2027-06-01' where id = %L$$, :session1), 'session cannot shrink past its terms', 'falls outside');
select public.set_current_term(:term2);
select tests.eq((select is_current from public.terms where id = :term2), true, 'set_current_term switches the term');
select tests.eq((select count(*) from public.terms where school_id = :s1 and is_current), 1::bigint, 'still exactly one current term');
select tests.eq((select count(*) from public.terms where school_id = :s2 and is_current), 0::bigint, 'other school''s current term untouched (not visible)');
select tests.fails(format('select public.set_current_term(%L)', :gf_term1), 'admin cannot change another school''s term', 'only school administrators');
select tests.fails(format('delete from public.academic_sessions where id = %L', :session1), 'session with terms cannot be deleted', 'foreign key');
rollback;

\echo '--- WS1-5. Arms, tutors and assignments'
begin;
select tests.login(:sadmin);
set local role authenticated;
select tests.fails(format($$update public.class_arms set form_tutor_id = %L where name = 'A'$$, :parent), 'a parent cannot be a form tutor', 'must be a teacher');
select tests.fails(format($$update public.class_arms set form_tutor_id = %L where name = 'A'$$, :gf_teacher), 'another school''s teacher cannot be a form tutor', 'must be a teacher');
select tests.eq(tests.rows(format($$update public.class_arms a set form_tutor_id = %L from public.class_levels l where l.id = a.class_level_id and l.name = 'SS 1' and a.name = 'A'$$, :teacher)), 1, 'admin can set a form tutor');
select tests.fails(format($$
  insert into public.teacher_assignments (school_id, session_id, class_arm_id, subject_id, teacher_id)
  select %L, %L, a.id, s.id, %L from public.class_arms a join public.class_levels l on l.id = a.class_level_id, public.subjects s
   where l.name = 'JSS 1' and a.name = 'A' and s.name = 'Biology'$$, :s1, :session1, :teacher), 'cannot assign a subject the class does not offer', 'not offered');
select tests.fails(format($$
  insert into public.teacher_assignments (school_id, session_id, class_arm_id, subject_id, teacher_id)
  select %L, %L, a.id, s.id, %L from public.class_arms a join public.class_levels l on l.id = a.class_level_id, public.subjects s
   where l.name = 'JSS 1' and a.name = 'A' and s.name = 'Mathematics'$$, :s1, :session1, :dual), 'only one teacher per subject per arm per session', 'duplicate');
select tests.fails(format($$
  insert into public.teacher_assignments (school_id, session_id, class_arm_id, subject_id, teacher_id)
  select %L, %L, a.id, s.id, %L from public.class_arms a join public.class_levels l on l.id = a.class_level_id, public.subjects s
   where l.name = 'JSS 2' and a.name = 'B' and s.name = 'French'$$, :s1, :session1, :bursar), 'a bursar cannot be assigned to teach', 'must be a teacher');
select tests.fails($$delete from public.class_subjects cs using public.class_levels l, public.subjects s
   where l.id = cs.class_level_id and s.id = cs.subject_id and l.name = 'JSS 1' and s.name = 'Mathematics'$$, 'cannot drop a subject while teachers are assigned', 'remove those assignments first');
select tests.fails($$delete from public.class_levels where name = 'JSS 1'$$, 'cannot delete a class level that has arms', 'foreign key');
rollback;

\echo '--- WS1-6. Nigerian template and audit'
begin;
select tests.login(:sadmin);
set local role authenticated;
select tests.eq((public.apply_nigerian_template(:s1, array['nursery']) ->> 'levels_added')::int, 3, 'template adds Creche, Nursery 1 and Nursery 2');
select tests.eq((public.apply_nigerian_template(:s1, array['nursery', 'primary']) ->> 'levels_added')::int, 0, 'running the template again adds nothing');
select tests.fails(format($$select public.apply_nigerian_template(%L, array['university'])$$, :s1), 'unknown section rejected', 'unknown section');
reset role;
select tests.eq((select count(*) from public.audit_log where table_name = 'class_levels' and actor_id = :sadmin::uuid), 3::bigint, 'template changes are audited against the admin');
rollback;

begin;
-- Deleting a whole school still works (cascade is not blocked by the protections).
delete from public.schools where id = :s2;
select tests.eq((select count(*) from public.class_levels where school_id = :s2), 0::bigint, 'deleting a school removes its structure');
rollback;

begin;
delete from public.schools where id = :s2;
select tests.eq((select count(*) from public.audit_log where table_name = 'schools' and action = 'DELETE' and record_id = '22222222-2222-2222-2222-222222222222'), 1::bigint, 'school deletion itself is still audited');
rollback;
