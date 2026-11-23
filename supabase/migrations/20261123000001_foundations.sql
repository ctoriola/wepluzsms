-- =============================================================================
-- WS0 Foundations: tenancy, profiles, memberships, access helpers, RLS
-- Tasks 0.09 - 0.13
--
-- Design notes
-- * Every school is a tenant. Every tenant-owned table carries school_id and is
--   protected by row-level security (RLS).
-- * A user's access comes from school_memberships (user, school, role), not from
--   a single role on the profile. One person can be a teacher AND a parent, or
--   belong to several schools in a group.
-- * Helper functions are SECURITY DEFINER with an empty search_path so they can
--   read memberships without RLS recursion and cannot be hijacked.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Shared utilities
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Normalise a phone number to E.164. Nigerian local numbers (0803...) become +234803...
create or replace function public.normalize_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  digits text;
begin
  if p_phone is null or btrim(p_phone) = '' then
    return null;
  end if;
  digits := regexp_replace(p_phone, '[^0-9]', '', 'g');
  if digits = '' then
    return null;
  end if;
  if left(btrim(p_phone), 1) = '+' then
    return '+' || digits;
  elsif left(digits, 3) = '234' then
    return '+' || digits;
  elsif left(digits, 1) = '0' and length(digits) = 11 then
    return '+234' || substr(digits, 2);
  else
    return '+' || digits;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
create type public.app_role as enum (
  'proprietor',    -- school owner; full control
  'principal',     -- head of school
  'school_admin',  -- administrative officer / ICT admin
  'bursar',        -- finance
  'teacher',
  'parent'
);

-- ---------------------------------------------------------------------------
-- 0.09 Schools and settings
-- ---------------------------------------------------------------------------
create table public.schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 200),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  short_code  text not null check (short_code ~ '^[A-Z0-9]{2,8}$'),
  status      text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on column public.schools.slug is 'URL-safe identifier, e.g. used as subdomain (slug.app-domain).';
comment on column public.schools.short_code is 'Uppercase code used in admission and invoice numbers, e.g. WPZ.';

create table public.school_settings (
  school_id      uuid primary key references public.schools (id) on delete cascade,
  motto          text check (length(motto) <= 200),
  address        text check (length(address) <= 500),
  city           text check (length(city) <= 100),
  state          text check (length(state) <= 100),
  country        text not null default 'Nigeria',
  phone          text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  email          text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  website        text check (length(website) <= 200),
  logo_path      text,
  primary_color  text not null default '#14213D' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color   text not null default '#0F766E' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  currency       text not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  timezone       text not null default 'Africa/Lagos',
  updated_at     timestamptz not null default now()
);
comment on column public.school_settings.logo_path is 'Object path inside the school-assets storage bucket: {school_id}/logo-....webp';

create trigger schools_set_updated_at before update on public.schools
  for each row execute function public.set_updated_at();
create trigger school_settings_set_updated_at before update on public.school_settings
  for each row execute function public.set_updated_at();

-- Every new school automatically gets a settings row.
create or replace function public.handle_new_school()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.school_settings (school_id) values (new.id)
  on conflict (school_id) do nothing;
  return new;
end;
$$;

create trigger schools_create_settings after insert on public.schools
  for each row execute function public.handle_new_school();

-- ---------------------------------------------------------------------------
-- 0.10 Profiles (one per auth user)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  full_name        text check (length(full_name) <= 200),
  email            text,
  phone            text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  avatar_path      text,
  active_school_id uuid references public.schools (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on column public.profiles.email is 'Mirrored from auth.users; change it through Supabase Auth, not directly.';
comment on column public.profiles.phone is 'Mirrored from auth.users in E.164 format; change it through Supabase Auth.';
comment on column public.profiles.active_school_id is 'School currently selected in the app (for users in more than one school).';

create index profiles_email_idx on public.profiles (lower(email));
create index profiles_phone_idx on public.profiles (phone);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create and keep the profile in sync with auth.users.
-- IMPORTANT: memberships are NEVER created from user metadata here, because a
-- user can set their own metadata at sign-up. Memberships are created only by
-- the invite-member Edge Function (service role) after an authorisation check.
create or replace function public.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.profiles (id, full_name, email, phone)
    values (
      new.id,
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      lower(nullif(new.email, '')),
      public.normalize_phone(nullif(new.phone, ''))
    )
    on conflict (id) do nothing;
  else
    update public.profiles
       set email = lower(nullif(new.email, '')),
           phone = public.normalize_phone(nullif(new.phone, ''))
     where id = new.id
       and (email is distinct from lower(nullif(new.email, ''))
            or phone is distinct from public.normalize_phone(nullif(new.phone, '')));
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_auth_user_change();
create trigger on_auth_user_updated after update of email, phone on auth.users
  for each row execute function public.handle_auth_user_change();

-- ---------------------------------------------------------------------------
-- 0.11 Memberships and platform admins
-- ---------------------------------------------------------------------------
create table public.school_memberships (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.app_role not null,
  status      text not null default 'active' check (status in ('active', 'suspended')),
  invited_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (school_id, user_id, role)
);
create index school_memberships_user_idx on public.school_memberships (user_id) where status = 'active';
create index school_memberships_school_role_idx on public.school_memberships (school_id, role);

create trigger school_memberships_set_updated_at before update on public.school_memberships
  for each row execute function public.set_updated_at();

-- MANDEXA platform operators (not tied to any school).
create table public.platform_admins (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 0.12 Access helper functions
-- ---------------------------------------------------------------------------
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())
  );
$$;

-- Does the current user hold any of the given roles (active) in the school?
create or replace function public.has_school_role(p_school_id uuid, p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.school_memberships m
      join public.schools s on s.id = m.school_id
     where m.school_id = p_school_id
       and m.user_id = (select auth.uid())
       and m.status = 'active'
       and s.status = 'active'
       and m.role = any (p_roles)
  );
$$;

-- Is the current user an active member of the school (any role)? Platform admins always are.
create or replace function public.is_school_member(p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
      or public.has_school_role(p_school_id, enum_range(null::public.app_role));
$$;

-- Leadership / administration roles that manage school configuration.
create or replace function public.is_school_admin(p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
      or public.has_school_role(p_school_id,
           array['proprietor', 'principal', 'school_admin']::public.app_role[]);
$$;

-- Staff = everyone except parents.
create or replace function public.is_school_staff(p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
      or public.has_school_role(p_school_id,
           array['proprietor', 'principal', 'school_admin', 'bursar', 'teacher']::public.app_role[]);
$$;

-- May the current user grant, change or revoke the given role in the school?
--   platform admin and proprietor: any role
--   principal and school_admin:   school_admin, bursar, teacher, parent
create or replace function public.can_manage_role(p_school_id uuid, p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
      or public.has_school_role(p_school_id, array['proprietor']::public.app_role[])
      or (
        public.has_school_role(p_school_id, array['principal', 'school_admin']::public.app_role[])
        and p_role in ('school_admin', 'bursar', 'teacher', 'parent')
      );
$$;

-- The school the current user is working in: their chosen active school if they
-- still belong to it, otherwise their oldest active membership.
create or replace function public.current_school_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.active_school_id
       from public.profiles p
      where p.id = (select auth.uid())
        and p.active_school_id is not null
        and public.is_school_member(p.active_school_id)),
    (select m.school_id
       from public.school_memberships m
       join public.schools s on s.id = m.school_id and s.status = 'active'
      where m.user_id = (select auth.uid()) and m.status = 'active'
      order by m.created_at
      limit 1)
  );
$$;

-- Can the current user see another user's profile? Yes for themselves, and for
-- school admins looking at people who belong to their school.
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
           and public.is_school_admin(theirs.school_id)
      );
$$;

-- Public branding for a school's login page (safe for anonymous visitors).
create or replace function public.get_school_branding(p_slug text)
returns table (school_id uuid, name text, logo_path text, primary_color text, accent_color text, motto text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name, ss.logo_path, ss.primary_color, ss.accent_color, ss.motto
    from public.schools s
    join public.school_settings ss on ss.school_id = s.id
   where s.slug = lower(p_slug) and s.status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
-- A user may only pick an active school they belong to.
create or replace function public.check_active_school()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active_school_id is not null
     and new.active_school_id is distinct from old.active_school_id
     and (select auth.uid()) is not null
     and not public.is_school_member(new.active_school_id) then
    raise exception 'You are not a member of that school' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_check_active_school before update of active_school_id on public.profiles
  for each row execute function public.check_active_school();

-- A school must always keep at least one active proprietor.
create or replace function public.protect_last_proprietor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'proprietor' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'proprietor' or new.status <> 'active') then
    if not exists (
      select 1 from public.school_memberships m
       where m.school_id = old.school_id
         and m.role = 'proprietor'
         and m.status = 'active'
         and m.id <> old.id
    ) and exists (select 1 from public.schools s where s.id = old.school_id) then
      raise exception 'A school must keep at least one active proprietor' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger school_memberships_protect_proprietor
  before update or delete on public.school_memberships
  for each row execute function public.protect_last_proprietor();

-- ---------------------------------------------------------------------------
-- 0.13 Row-level security
-- Default for every table: RLS on, anonymous users get nothing, signed-in users
-- get only what a policy allows. Column grants stop users editing fields they
-- should not (for example their own role or school).
-- ---------------------------------------------------------------------------
alter table public.schools            enable row level security;
alter table public.school_settings    enable row level security;
alter table public.profiles           enable row level security;
alter table public.school_memberships enable row level security;
alter table public.platform_admins    enable row level security;

revoke all on public.schools, public.school_settings, public.profiles,
              public.school_memberships, public.platform_admins from anon;
revoke insert, update, delete on public.schools, public.school_settings, public.profiles,
              public.school_memberships, public.platform_admins from authenticated;

-- schools: members read; admins may rename; creating schools is a platform task.
create policy "Members can view their schools" on public.schools
  for select to authenticated using (public.is_school_member(id));
create policy "School admins can update their school" on public.schools
  for update to authenticated
  using (public.is_school_admin(id)) with check (public.is_school_admin(id));
grant update (name) on public.schools to authenticated;

-- school_settings: members read; admins edit.
create policy "Members can view school settings" on public.school_settings
  for select to authenticated using (public.is_school_member(school_id));
create policy "School admins can update school settings" on public.school_settings
  for update to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
grant update (motto, address, city, state, country, phone, email, website, logo_path,
              primary_color, accent_color, currency, timezone)
  on public.school_settings to authenticated;

-- profiles: see yourself (and, for admins, people in your school); edit only safe fields of your own.
create policy "Users can view permitted profiles" on public.profiles
  for select to authenticated using (public.can_view_profile(id));
create policy "Users can update their own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
grant update (full_name, avatar_path, active_school_id) on public.profiles to authenticated;

-- memberships: see your own; admins see everyone in their school.
-- New memberships are created only by the invite-member Edge Function.
-- Admins can change role/status or remove members they are allowed to manage,
-- but never their own membership (prevents self-promotion and self-lockout).
create policy "Users can view permitted memberships" on public.school_memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_school_admin(school_id));
create policy "Admins can update manageable memberships" on public.school_memberships
  for update to authenticated
  using (user_id <> (select auth.uid()) and public.can_manage_role(school_id, role))
  with check (user_id <> (select auth.uid()) and public.can_manage_role(school_id, role));
create policy "Admins can remove manageable memberships" on public.school_memberships
  for delete to authenticated
  using (user_id <> (select auth.uid()) and public.can_manage_role(school_id, role));
grant update (role, status) on public.school_memberships to authenticated;
grant delete on public.school_memberships to authenticated;

-- platform_admins: you can only see whether you yourself are one.
create policy "Users can see their own platform admin row" on public.platform_admins
  for select to authenticated using (user_id = (select auth.uid()));

-- Function access
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_platform_admin(),
  public.has_school_role(uuid, public.app_role[]),
  public.is_school_member(uuid),
  public.is_school_admin(uuid),
  public.is_school_staff(uuid),
  public.can_manage_role(uuid, public.app_role),
  public.current_school_id(),
  public.can_view_profile(uuid),
  public.normalize_phone(text)
  to authenticated;
grant execute on function public.get_school_branding(text) to anon, authenticated;
