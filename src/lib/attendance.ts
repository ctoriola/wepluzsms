import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { api, ApiError } from "./api";
import { db } from "./firebase";

export const MARKS = ["present", "absent", "late", "excused"] as const;
export type Mark = (typeof MARKS)[number];
export const MARK_LABEL: Record<Mark, string> = { present: "Present", absent: "Absent", late: "Late", excused: "Excused" };

export type Register = { id: string; armId: string; date: string; marks: Record<string, Mark>; counts: Record<Mark, number>; markedBy: string };

export const todayLagos = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
export const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());

export async function loadRegister(sid: string, armId: string, date: string): Promise<Register | null> {
  const snap = await getDoc(doc(db, "schools", sid, "attendance", `${armId}__${date}`));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Register) : null;
}

/** All registers for a day (leadership / bursar). */
export async function loadDayRegisters(sid: string, date: string): Promise<Register[]> {
  const snap = await getDocs(query(collection(db, "schools", sid, "attendance"), where("date", "==", date)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Register);
}

// ------------------------------------------------------------------ offline queue
// A register taken without internet is kept on this phone and sent when back online.
type Queued = { schoolId: string; armId: string; date: string; marks: Record<string, Mark>; label: string; queuedAt: number };
const KEY = "wepluz.attendanceQueue";

export function queued(): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Queued[];
  } catch {
    return [];
  }
}
function store(items: Queued[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable */
  }
}

/** Save a register; if there is no connection, keep it on the phone instead. */
export async function saveRegister(item: Omit<Queued, "queuedAt">): Promise<"sent" | "queued"> {
  try {
    await api("attendance.save", { schoolId: item.schoolId, armId: item.armId, date: item.date, marks: item.marks });
    store(queued().filter((q) => !(q.armId === item.armId && q.date === item.date)));
    return "sent";
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) {
      store([...queued().filter((q) => !(q.armId === item.armId && q.date === item.date)), { ...item, queuedAt: Date.now() }]);
      return "queued";
    }
    throw err;
  }
}

/** Try to send everything waiting on this phone. Returns how many were sent and any errors. */
export async function flushQueue(): Promise<{ sent: number; failed: { label: string; error: string }[] }> {
  let sent = 0;
  const failed: { label: string; error: string }[] = [];
  for (const q of queued()) {
    try {
      await api("attendance.save", { schoolId: q.schoolId, armId: q.armId, date: q.date, marks: q.marks });
      store(queued().filter((x) => !(x.armId === q.armId && x.date === q.date)));
      sent++;
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) break; // still offline
      store(queued().filter((x) => !(x.armId === q.armId && x.date === q.date)));
      failed.push({ label: `${q.label} (${q.date})`, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { sent, failed };
}
