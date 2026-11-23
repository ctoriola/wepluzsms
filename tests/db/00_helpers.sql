-- Shared test helpers and fixed ids (from supabase/seed.sql).
-- Loaded once before every *_test.sql file in the same psql session.
\set ON_ERROR_STOP 1
\set QUIET 1

-- ---------------------------------------------------------------- helpers
create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

create function tests.eq(p_actual anyelement, p_expected anyelement, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % (expected %, got %)', p_label, p_expected, p_actual;
  end if;
  raise notice 'ok - %', p_label;
end;
$$;

-- Run SQL and return the number of rows it affected.
create function tests.rows(p_sql text) returns integer language plpgsql as $$
declare n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- SQL must raise an error (optionally containing p_contains).
create function tests.fails(p_sql text, p_label text, p_contains text default null) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_contains is not null and position(lower(p_contains) in lower(sqlerrm)) = 0 then
      raise exception 'FAIL: % (raised "%" but expected text "%")', p_label, sqlerrm, p_contains;
    end if;
    raise notice 'ok - % (blocked: %)', p_label, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % (statement succeeded but should have been blocked)', p_label;
end;
$$;
grant execute on all functions in schema tests to anon, authenticated;

-- Fixed ids from supabase/seed.sql
\set s1 '''11111111-1111-1111-1111-111111111111'''
\set s2 '''22222222-2222-2222-2222-222222222222'''
\set platform '''00000000-0000-0000-0000-0000000000a1'''
\set proprietor '''00000000-0000-0000-0000-0000000000b1'''
\set principal '''00000000-0000-0000-0000-0000000000b2'''
\set sadmin '''00000000-0000-0000-0000-0000000000b3'''
\set bursar '''00000000-0000-0000-0000-0000000000b4'''
\set teacher '''00000000-0000-0000-0000-0000000000b5'''
\set dual '''00000000-0000-0000-0000-0000000000b6'''
\set parent '''00000000-0000-0000-0000-0000000000b7'''
\set gf_prop '''00000000-0000-0000-0000-0000000000c1'''

\set parent2 '''00000000-0000-0000-0000-0000000000b8'''
\set gf_teacher '''00000000-0000-0000-0000-0000000000c2'''
\set session1 '''33333333-0000-0000-0000-000000000001'''
\set session2 '''33333333-0000-0000-0000-000000000002'''
\set term1 '''33333333-0000-0000-0000-000000000011'''
\set term2 '''33333333-0000-0000-0000-000000000012'''
\set gf_term1 '''33333333-0000-0000-0000-000000000021'''
