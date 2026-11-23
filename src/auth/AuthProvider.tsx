import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { applyBranding } from "@/lib/branding";
import { hasAny, type Role } from "@/lib/roles";
import { supabase } from "@/lib/supabase";

export type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_path: string | null;
  active_school_id: string | null;
};

export type SchoolInfo = {
  id: string;
  name: string;
  slug: string;
  short_code: string;
  logo_path: string | null;
  primary_color: string;
  accent_color: string;
  motto: string | null;
};

type Membership = { id: string; school_id: string; role: Role };

type AuthState = {
  loading: boolean;
  /** Set when the user's school data could not be loaded (e.g. no internet). */
  loadError: string | null;
  session: Session | null;
  profile: Profile | null;
  isPlatformAdmin: boolean;
  schools: SchoolInfo[];
  activeSchool: SchoolInfo | null;
  /** Roles the user holds in the active school. */
  roles: Role[];
  /** True if the user holds any of the given roles in the active school (platform admins always pass). */
  can: (wanted: Role[]) => boolean;
  switchSchool: (schoolId: string) => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const SCHOOL_COLUMNS = "id, name, slug, short_code, school_settings(logo_path, primary_color, accent_color, motto)";

type SchoolRow = {
  id: string;
  name: string;
  slug: string;
  short_code: string;
  school_settings: Partial<SchoolInfo> | Partial<SchoolInfo>[] | null;
};

function toSchoolInfo(row: SchoolRow): SchoolInfo {
  const s = Array.isArray(row.school_settings) ? row.school_settings[0] : row.school_settings;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    short_code: row.short_code,
    logo_path: s?.logo_path ?? null,
    primary_color: s?.primary_color ?? "#14213D",
    accent_color: s?.accent_color ?? "#0F766E",
    motto: s?.motto ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [schools, setSchools] = useState<SchoolInfo[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeSchoolId, setActiveSchoolId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setSessionChecked(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  const load = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setSchools([]);
      setMemberships([]);
      setIsPlatformAdmin(false);
      setActiveSchoolId(null);
      setLoadedFor(null);
      return;
    }
    setLoadError(null);
    try {
      const [profileRes, memberRes, adminRes] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, phone, avatar_path, active_school_id").eq("id", userId).maybeSingle(),
        supabase.from("school_memberships").select(`id, school_id, role, schools(${SCHOOL_COLUMNS})`).eq("user_id", userId).eq("status", "active"),
        supabase.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
      ]);
      const failed = profileRes.error ?? memberRes.error ?? adminRes.error;
      if (failed) throw failed;
      const platformAdmin = Boolean(adminRes.data);
      const memberRows = (memberRes.data ?? []) as unknown as (Membership & { schools: SchoolRow | null })[];

      let schoolList: SchoolInfo[];
      if (platformAdmin) {
        const { data } = await supabase.from("schools").select(SCHOOL_COLUMNS).eq("status", "active").order("name");
        schoolList = ((data ?? []) as unknown as SchoolRow[]).map(toSchoolInfo);
      } else {
        const byId = new Map<string, SchoolInfo>();
        for (const m of memberRows) if (m.schools) byId.set(m.schools.id, toSchoolInfo(m.schools));
        schoolList = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
      }

      const p = (profileRes.data as Profile | null) ?? null;
      setProfile(p);
      setIsPlatformAdmin(platformAdmin);
      setMemberships(memberRows.map(({ id, school_id, role }) => ({ id, school_id, role })));
      setSchools(schoolList);
      setActiveSchoolId((current) => {
        const preferred = current ?? p?.active_school_id;
        return schoolList.some((s) => s.id === preferred) ? preferred! : schoolList[0]?.id ?? null;
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load your account.");
    } finally {
      setLoadedFor(userId);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeSchool = schools.find((s) => s.id === activeSchoolId) ?? null;

  useEffect(() => {
    applyBranding(activeSchool?.primary_color, activeSchool?.accent_color);
  }, [activeSchool?.primary_color, activeSchool?.accent_color]);

  const roles = useMemo(
    () => memberships.filter((m) => m.school_id === activeSchoolId).map((m) => m.role),
    [memberships, activeSchoolId],
  );

  const can = useCallback((wanted: Role[]) => isPlatformAdmin || hasAny(roles, wanted), [isPlatformAdmin, roles]);

  const switchSchool = useCallback(
    async (schoolId: string) => {
      setActiveSchoolId(schoolId);
      if (userId) await supabase.from("profiles").update({ active_school_id: schoolId }).eq("id", userId);
    },
    [userId],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setActiveSchoolId(null);
  }, []);

  const value: AuthState = {
    loading: !sessionChecked || (userId !== null && loadedFor !== userId),
    loadError,
    session,
    profile,
    isPlatformAdmin,
    schools,
    activeSchool,
    roles,
    can,
    switchSchool,
    refresh: load,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
