import { onAuthStateChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, onSnapshot } from "firebase/firestore";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { applyBranding } from "@/lib/branding";
import { auth, db } from "@/lib/firebase";
import { hasAny, type Role } from "@/lib/roles";

export type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  active_school_id: string | null;
};

export type SchoolInfo = {
  id: string;
  name: string;
  slug: string;
  short_code: string;
  /** Logo as a data URL (stored small inside Firestore), or null. */
  logo: string | null;
  primary_color: string;
  accent_color: string;
  motto: string | null;
};

export type CurrentTerm = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  next_term_begins: string | null;
  session_id: string;
  session_name: string;
};

type UserDoc = {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  activeSchoolId?: string | null;
  memberships?: Record<string, { roles: Role[]; status: string }>;
};

type SchoolDoc = {
  name: string;
  slug: string;
  shortCode: string;
  status: string;
  currentTermId?: string | null;
  settings?: { motto?: string | null; primaryColor?: string; accentColor?: string; hasLogo?: boolean; logoVersion?: number };
};

type AuthState = {
  loading: boolean;
  /** Set when school data could not be loaded (e.g. no internet). */
  loadError: string | null;
  session: User | null;
  profile: Profile | null;
  isPlatformAdmin: boolean;
  schools: SchoolInfo[];
  activeSchool: SchoolInfo | null;
  currentTerm: CurrentTerm | null;
  refreshCalendar: () => Promise<void>;
  /** Roles the user holds in the active school. */
  roles: Role[];
  /** True if the user holds any of the given roles in the active school (platform admins always pass). */
  can: (wanted: Role[]) => boolean;
  switchSchool: (schoolId: string) => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const toInfo = (id: string, s: SchoolDoc, logo: string | null): SchoolInfo => ({
  id,
  name: s.name,
  slug: s.slug,
  short_code: s.shortCode,
  logo,
  primary_color: s.settings?.primaryColor ?? "#14213D",
  accent_color: s.settings?.accentColor ?? "#0F766E",
  motto: s.settings?.motto ?? null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [userDocFor, setUserDocFor] = useState<string | null>(null);
  const [schools, setSchools] = useState<SchoolInfo[] | null>(null);
  const [activeSchoolId, setActiveSchoolId] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<SchoolDoc | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [currentTerm, setCurrentTerm] = useState<CurrentTerm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [schoolsKey, setSchoolsKey] = useState(0);

  // 1. Who is signed in (and are they a platform admin?)
  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        setUser(u);
        setIsPlatformAdmin(u ? (await u.getIdTokenResult()).claims.platformAdmin === true : false);
        setAuthChecked(true);
      }),
    [],
  );

  const uid = user?.uid ?? null;

  // 2. Their profile and memberships, live.
  useEffect(() => {
    setUserDoc(null);
    setUserDocFor(null);
    setSchools(null);
    if (!uid) return;
    return onSnapshot(
      doc(db, "users", uid),
      (snap) => {
        setUserDoc((snap.data() as UserDoc | undefined) ?? {});
        setUserDocFor(uid);
        setLoadError(null);
      },
      (err) => {
        setLoadError(err.message);
        setUserDocFor(uid);
      },
    );
  }, [uid, reloadKey]);

  const membershipKey = JSON.stringify(userDoc?.memberships ?? {});

  // 3. The schools they can open.
  useEffect(() => {
    if (!uid || userDocFor !== uid) return;
    let cancelled = false;
    (async () => {
      try {
        let list: SchoolInfo[];
        if (isPlatformAdmin) {
          const snap = await getDocs(collection(db, "schools"));
          list = snap.docs.filter((d) => d.data().status === "active").map((d) => toInfo(d.id, d.data() as SchoolDoc, null));
        } else {
          const ids = Object.entries(userDoc?.memberships ?? {})
            .filter(([, m]) => m.status === "active")
            .map(([sid]) => sid);
          const docs = await Promise.all(ids.map((sid) => getDoc(doc(db, "schools", sid)).catch(() => null)));
          list = docs.filter((d) => d?.exists() && d.data()?.status === "active").map((d) => toInfo(d!.id, d!.data() as SchoolDoc, null));
        }
        if (!cancelled) setSchools(list.sort((a, b) => a.name.localeCompare(b.name)));
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load your schools.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, userDocFor, isPlatformAdmin, membershipKey, schoolsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 4. Pick the active school.
  useEffect(() => {
    if (!schools) return;
    setActiveSchoolId((current) => {
      const preferred = current ?? userDoc?.activeSchoolId ?? null;
      return schools.some((s) => s.id === preferred) ? preferred : schools[0]?.id ?? null;
    });
  }, [schools, userDoc?.activeSchoolId]);

  // 5. Watch the active school (name, colours, logo version, current term), live.
  useEffect(() => {
    setActiveDoc(null);
    if (!activeSchoolId) return;
    return onSnapshot(doc(db, "schools", activeSchoolId), (snap) => setActiveDoc((snap.data() as SchoolDoc) ?? null), () => setActiveDoc(null));
  }, [activeSchoolId]);

  const logoVersion = activeDoc?.settings?.hasLogo ? activeDoc.settings.logoVersion ?? 1 : 0;
  useEffect(() => {
    setLogo(null);
    if (!activeSchoolId || !logoVersion) return;
    getDoc(doc(db, "schools", activeSchoolId, "assets", "logo"))
      .then((s) => setLogo((s.data()?.dataUrl as string | undefined) ?? null))
      .catch(() => setLogo(null));
  }, [activeSchoolId, logoVersion]);

  // Always read the current term id fresh (never from a stale closure), and let
  // only the most recent request update state, so overlapping refreshes cannot
  // put an old term back on screen.
  const calendarRequest = useRef(0);
  const refreshCalendar = useCallback(async () => {
    const req = ++calendarRequest.current;
    const apply = (t: CurrentTerm | null) => req === calendarRequest.current && setCurrentTerm(t);
    if (!activeSchoolId) return void apply(null);
    const termId = (await getDoc(doc(db, "schools", activeSchoolId))).data()?.currentTermId as string | undefined;
    if (!termId) return void apply(null);
    const t = await getDoc(doc(db, "schools", activeSchoolId, "terms", termId));
    const td = t.data();
    if (!td) return void apply(null);
    const s = await getDoc(doc(db, "schools", activeSchoolId, "sessions", td.sessionId));
    apply({
      id: t.id,
      name: td.name,
      start_date: td.startDate,
      end_date: td.endDate,
      next_term_begins: td.nextTermBegins ?? null,
      session_id: td.sessionId,
      session_name: (s.data()?.name as string | undefined) ?? "",
    });
  }, [activeSchoolId, activeDoc?.currentTermId]);

  useEffect(() => {
    void refreshCalendar().catch(() => setCurrentTerm(null));
  }, [refreshCalendar]);

  const activeSchool = useMemo(
    () => (activeSchoolId && activeDoc ? toInfo(activeSchoolId, activeDoc, logo) : schools?.find((s) => s.id === activeSchoolId) ?? null),
    [activeSchoolId, activeDoc, logo, schools],
  );

  useEffect(() => {
    applyBranding(activeSchool?.primary_color, activeSchool?.accent_color);
  }, [activeSchool?.primary_color, activeSchool?.accent_color]);

  const roles = useMemo(() => {
    const m = activeSchoolId ? userDoc?.memberships?.[activeSchoolId] : undefined;
    return m && m.status === "active" ? m.roles : [];
  }, [userDoc, activeSchoolId]);

  const can = useCallback((wanted: Role[]) => isPlatformAdmin || hasAny(roles, wanted), [isPlatformAdmin, roles]);

  const switchSchool = useCallback(async (schoolId: string) => {
    setActiveSchoolId(schoolId);
    await api("me.setActiveSchool", { schoolId }).catch(() => undefined);
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(auth);
    setActiveSchoolId(null);
  }, []);

  const profile: Profile | null = user
    ? {
        id: user.uid,
        full_name: userDoc?.fullName ?? user.displayName ?? null,
        email: userDoc?.email ?? user.email ?? null,
        phone: userDoc?.phone ?? user.phoneNumber ?? null,
        active_school_id: userDoc?.activeSchoolId ?? null,
      }
    : null;

  const value: AuthState = {
    loading: !authChecked || (uid !== null && (userDocFor !== uid || (schools === null && !loadError))),
    loadError,
    session: user,
    profile,
    isPlatformAdmin,
    schools: schools ?? [],
    activeSchool,
    currentTerm,
    refreshCalendar,
    roles,
    can,
    switchSchool,
    // Re-read the school list in place (no loading screen); after an error, also reconnect.
    refresh: async () => {
      if (loadError) setReloadKey((k) => k + 1);
      setSchoolsKey((k) => k + 1);
    },
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
