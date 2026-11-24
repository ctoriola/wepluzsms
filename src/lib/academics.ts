import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";

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

export type ClassArm = { id: string; class_level_id: string; name: string; form_tutor_id: string | null; capacity: number | null; teacher_ids: string[] };
export type ClassLevel = { id: string; name: string; section: Section; order_index: number; class_arms: ClassArm[] };
export type Subject = { id: string; name: string; short_code: string; category: SubjectCategory };
export type ClassSubject = { id: string; class_level_id: string; subject_id: string; is_compulsory: boolean };
export type StaffOption = { id: string; name: string };
export type TeacherAssignment = { id: string; session_id: string; class_arm_id: string; subject_id: string; teacher_id: string };

const sdoc = (sid: string) => doc(db, "schools", sid);
const scol = (sid: string, name: string) => collection(db, "schools", sid, name);

async function currentIds(schoolId: string) {
  const d = (await getDoc(sdoc(schoolId))).data();
  return { termId: (d?.currentTermId as string | null) ?? null, sessionId: (d?.currentSessionId as string | null) ?? null };
}

export async function loadSessions(schoolId: string): Promise<AcademicSession[]> {
  const [sessions, terms, cur] = await Promise.all([getDocs(scol(schoolId, "sessions")), getDocs(scol(schoolId, "terms")), currentIds(schoolId)]);
  const allTerms: Term[] = terms.docs.map((t) => {
    const d = t.data();
    return {
      id: t.id,
      session_id: d.sessionId,
      term_number: d.termNumber,
      name: d.name,
      start_date: d.startDate,
      end_date: d.endDate,
      next_term_begins: d.nextTermBegins ?? null,
      is_current: t.id === cur.termId,
    };
  });
  return sessions.docs
    .map((s) => {
      const d = s.data();
      return {
        id: s.id,
        name: d.name,
        start_date: d.startDate,
        end_date: d.endDate,
        is_current: s.id === cur.sessionId,
        terms: allTerms.filter((t) => t.session_id === s.id).sort((a, b) => a.term_number - b.term_number),
      };
    })
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
}

export async function loadLevels(schoolId: string): Promise<ClassLevel[]> {
  const [levels, arms] = await Promise.all([getDocs(scol(schoolId, "classLevels")), getDocs(scol(schoolId, "classArms"))]);
  const allArms: ClassArm[] = arms.docs.map((a) => {
    const d = a.data();
    return { id: a.id, class_level_id: d.levelId, name: d.name, form_tutor_id: d.formTutorId ?? null, capacity: d.capacity ?? null, teacher_ids: (d.teacherIds ?? []) as string[] };
  });
  return levels.docs
    .map((l) => {
      const d = l.data();
      return {
        id: l.id,
        name: d.name as string,
        section: d.section as Section,
        order_index: d.order as number,
        class_arms: allArms.filter((a) => a.class_level_id === l.id).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
      };
    })
    .sort((a, b) => a.order_index - b.order_index || a.name.localeCompare(b.name));
}

export async function loadSubjects(schoolId: string): Promise<Subject[]> {
  const snap = await getDocs(scol(schoolId, "subjects"));
  return snap.docs
    .map((s) => ({ id: s.id, name: s.data().name, short_code: s.data().shortCode, category: s.data().category }) as Subject)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Subjects offered per class level (stored as a map on each level). */
export async function loadClassSubjects(schoolId: string): Promise<ClassSubject[]> {
  const snap = await getDocs(scol(schoolId, "classLevels"));
  return snap.docs.flatMap((l) =>
    Object.entries((l.data().subjects ?? {}) as Record<string, string>).map(([subjectId, state]) => ({
      id: `${l.id}:${subjectId}`,
      class_level_id: l.id,
      subject_id: subjectId,
      is_compulsory: state === "compulsory",
    })),
  );
}

/** Active teachers and school leaders (people who can teach or be form tutors). Admin-only read. */
export async function loadTeachingStaff(schoolId: string): Promise<StaffOption[]> {
  const snap = await getDocs(scol(schoolId, "members"));
  return snap.docs
    .map((m) => m.data())
    .filter((m) => m.status === "active" && (m.roles as string[]).some((r) => ["teacher", "principal", "school_admin", "proprietor"].includes(r)))
    .map((m) => ({ id: m.uid as string, name: (m.fullName || m.email || "Unnamed") as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadAssignments(schoolId: string, sessionId: string, teacherId?: string): Promise<TeacherAssignment[]> {
  const filters = [where("sessionId", "==", sessionId), ...(teacherId ? [where("teacherId", "==", teacherId)] : [])];
  const snap = await getDocs(query(scol(schoolId, "assignments"), ...filters));
  return snap.docs.map((a) => {
    const d = a.data();
    return { id: a.id, session_id: d.sessionId, class_arm_id: d.armId, subject_id: d.subjectId, teacher_id: d.teacherId };
  });
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
