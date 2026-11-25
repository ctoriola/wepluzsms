import { collection, doc, getDoc, getDocs, query, where, type QueryConstraint } from "firebase/firestore";
import { db } from "./firebase";

export const RELATIONSHIPS = ["Mother", "Father", "Guardian", "Grandparent", "Uncle", "Aunt", "Sibling", "Sponsor", "Other"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta",
  "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
  "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
  "Taraba", "Yobe", "Zamfara",
];

export type GuardianLink = { guardianId: string; relationship: Relationship; isPrimary: boolean; canPickup: boolean; receivesBilling: boolean };

export type Student = {
  id: string;
  admissionNo: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: "male" | "female";
  dateOfBirth: string | null;
  stateOfOrigin: string | null;
  lga: string | null;
  religion: string | null;
  admissionDate: string;
  status: "active" | "withdrawn" | "graduated";
  currentSessionId: string | null;
  currentArmId: string | null;
  currentLevelId: string | null;
  guardians: GuardianLink[];
  parentUids: string[];
  hasMedicalAlert: boolean;
  hasPhoto: boolean;
  photoVersion: number;
  withdrawal: { date: string; reason: string } | null;
  searchKey: string;
};

export type Guardian = {
  id: string;
  fullName: string;
  phone: string | null;
  whatsappPhone: string | null;
  email: string | null;
  address: string | null;
  occupation: string | null;
  uid: string | null;
  studentIds: string[];
};

export type Medical = {
  bloodGroup: string | null;
  genotype: string | null;
  allergies: string | null;
  conditions: string | null;
  medications: string | null;
  doctor: string | null;
  notes: string | null;
};

export type Enrolment = { id: string; studentId: string; sessionId: string; armId: string; levelId: string; status: string; startDate: string; endDate: string | null };

const scol = (sid: string, name: string) => collection(db, "schools", sid, name);

export const fullName = (s: Pick<Student, "firstName" | "middleName" | "lastName">) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
export const initials = (s: Pick<Student, "firstName" | "lastName">) => `${s.firstName[0] ?? ""}${s.lastName[0] ?? ""}`.toUpperCase();

export function ageOn(dob: string | null, on = new Date().toISOString().slice(0, 10)) {
  if (!dob) return null;
  const [y, m, d] = dob.split("-").map(Number);
  const [y2, m2, d2] = on.split("-").map(Number);
  return y2 - y - (m2 < m || (m2 === m && d2 < d) ? 1 : 0);
}

async function list<T>(sid: string, name: string, ...c: QueryConstraint[]): Promise<T[]> {
  const snap = await getDocs(c.length ? query(scol(sid, name), ...c) : scol(sid, name));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
}

/** All students (leadership / bursar). */
export const loadAllStudents = (sid: string) => list<Student>(sid, "students");

/** Students in the given arms (what a teacher may see). One query per arm, as the security rules expect. */
export async function loadStudentsInArms(sid: string, armIds: string[]) {
  const parts = await Promise.all(armIds.map((a) => list<Student>(sid, "students", where("currentArmId", "==", a))));
  return parts.flat();
}

/** A parent's own children. */
export const loadMyChildren = (sid: string, uid: string) => list<Student>(sid, "students", where("parentUids", "array-contains", uid));

export async function loadStudent(sid: string, id: string): Promise<Student | null> {
  const snap = await getDoc(doc(db, "schools", sid, "students", id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Student) : null;
}

export async function loadPhoto(sid: string, id: string): Promise<string | null> {
  const snap = await getDoc(doc(db, "schools", sid, "studentPhotos", id)).catch(() => null);
  return (snap?.data()?.dataUrl as string | undefined) ?? null;
}

export async function loadMedical(sid: string, id: string): Promise<Medical | null> {
  const snap = await getDoc(doc(db, "schools", sid, "studentMedical", id));
  return snap.exists() ? (snap.data() as Medical) : null;
}

export async function loadGuardians(sid: string, ids: string[]): Promise<Guardian[]> {
  const snaps = await Promise.all(ids.map((id) => getDoc(doc(db, "schools", sid, "guardians", id)).catch(() => null)));
  return snaps.filter((s) => s?.exists()).map((s) => ({ id: s!.id, ...s!.data() }) as Guardian);
}

export const loadAllGuardians = (sid: string) => list<Guardian>(sid, "guardians");

export const loadEnrolments = (sid: string, studentId: string) => list<Enrolment>(sid, "enrolments", where("studentId", "==", studentId));
