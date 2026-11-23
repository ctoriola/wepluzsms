import { must } from "./data";
import { supabase } from "./supabase";

export type Section = "nursery" | "primary" | "junior_secondary" | "senior_secondary";
export const SECTIONS: Section[] = ["nursery", "primary", "junior_secondary", "senior_secondary"];
export const SECTION_LABELS: Record<Section, string> = {
  nursery: "Nursery",
  primary: "Primary",
  junior_secondary: "Junior Secondary",
  senior_secondary: "Senior Secondary",
};

export const SUBJECT_CATEGORIES = ["core", "science", "arts", "commercial", "trade", "language", "religious", "vocational", "early_years", "other"] as const;
export type SubjectCategory = (typeof SUBJECT_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<SubjectCategory, string> = {
  core: "Core",
  science: "Science",
  arts: "Arts / Humanities",
  commercial: "Commercial",
  trade: "Trade",
  language: "Language",
  religious: "Religious",
  vocational: "Vocational",
  early_years: "Early years",
  other: "Other",
};

export type Term = {
  id: string;
  session_id: string;
  term_number: number;
  name: string;
  start_date: string;
  end_date: string;
  next_term_begins: string | null;
  is_current: boolean;
};
export type AcademicSession = { id: string; name: string; start_date: string; end_date: string; is_current: boolean; terms: Term[] };

export type ClassArm = { id: string; class_level_id: string; name: string; form_tutor_id: string | null; capacity: number | null };
export type ClassLevel = { id: string; name: string; section: Section; order_index: number; class_arms: ClassArm[] };
export type Subject = { id: string; name: string; short_code: string; category: SubjectCategory };
export type ClassSubject = { id: string; class_level_id: string; subject_id: string; is_compulsory: boolean };
export type StaffOption = { id: string; name: string };
export type TeacherAssignment = { id: string; session_id: string; class_arm_id: string; subject_id: string; teacher_id: string };

export async function loadSessions(schoolId: string): Promise<AcademicSession[]> {
  const rows = must(
    await supabase
      .from("academic_sessions")
      .select("id, name, start_date, end_date, is_current, terms(id, session_id, term_number, name, start_date, end_date, next_term_begins, is_current)")
      .eq("school_id", schoolId)
      .order("start_date", { ascending: false }),
  ) as AcademicSession[];
  return rows.map((s) => ({ ...s, terms: [...(s.terms ?? [])].sort((a, b) => a.term_number - b.term_number) }));
}

export async function loadLevels(schoolId: string): Promise<ClassLevel[]> {
  const rows = must(
    await supabase
      .from("class_levels")
      .select("id, name, section, order_index, class_arms(id, class_level_id, name, form_tutor_id, capacity)")
      .eq("school_id", schoolId)
      .order("order_index")
      .order("name"),
  ) as ClassLevel[];
  return rows.map((l) => ({ ...l, class_arms: [...(l.class_arms ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) }));
}

export async function loadSubjects(schoolId: string): Promise<Subject[]> {
  return must(await supabase.from("subjects").select("id, name, short_code, category").eq("school_id", schoolId).order("name")) as Subject[];
}

export async function loadClassSubjects(schoolId: string): Promise<ClassSubject[]> {
  return must(await supabase.from("class_subjects").select("id, class_level_id, subject_id, is_compulsory").eq("school_id", schoolId)) as ClassSubject[];
}

/** Active teachers and school leaders (people who can teach or be form tutors). */
export async function loadTeachingStaff(schoolId: string): Promise<StaffOption[]> {
  const rows = must(
    await supabase
      .from("school_memberships")
      .select("user_id, role, profiles!school_memberships_user_id_fkey(full_name, email)")
      .eq("school_id", schoolId)
      .eq("status", "active")
      .in("role", ["teacher", "principal", "school_admin", "proprietor"]),
  ) as unknown as { user_id: string; profiles: { full_name: string | null; email: string | null } | null }[];
  const byId = new Map<string, StaffOption>();
  for (const r of rows) byId.set(r.user_id, { id: r.user_id, name: r.profiles?.full_name || r.profiles?.email || "Unnamed" });
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function levelArmLabel(level: Pick<ClassLevel, "name">, arm: Pick<ClassArm, "name">) {
  return `${level.name} ${arm.name}`;
}

/** Suggested dates for a new session starting in September of `startYear`. */
export function suggestSession(startYear: number) {
  return { name: `${startYear}/${startYear + 1}`, start_date: `${startYear}-09-07`, end_date: `${startYear + 1}-07-23` };
}

/** Suggested term dates inside a session (editable by the school). */
export function suggestTerm(session: Pick<AcademicSession, "start_date" | "end_date">, termNumber: 1 | 2 | 3) {
  const y1 = Number(session.start_date.slice(0, 4));
  const y2 = Number(session.end_date.slice(0, 4));
  if (termNumber === 1) return { name: "First Term", start_date: session.start_date, end_date: `${y1}-12-11`, next_term_begins: `${y2}-01-11` };
  if (termNumber === 2) return { name: "Second Term", start_date: `${y2}-01-11`, end_date: `${y2}-04-01`, next_term_begins: `${y2}-04-26` };
  return { name: "Third Term", start_date: `${y2}-04-26`, end_date: session.end_date, next_term_begins: null };
}
