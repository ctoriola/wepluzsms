import { CalendarCheck, CalendarDays, CheckCircle2, Circle } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth, type CurrentTerm } from "@/auth/AuthProvider";
import { Badge, PageHeader } from "@/components/ui";
import { collection, doc, getCountFromServer, getDoc, getDocs, query, where } from "firebase/firestore";
import { loadAssignments, loadLevels, loadSubjects } from "@/lib/academics";
import { isWeekend, loadDayRegisters, loadRegister, todayLagos, type Register } from "@/lib/attendance";
import { daysBetween, formatDate, todayIso, useAsync } from "@/lib/data";
import { db } from "@/lib/firebase";
import { ADMIN_ROLES } from "@/lib/roles";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function AttendanceTodayCard({ schoolId, seesAll, userId }: { schoolId: string; seesAll: boolean; userId: string }) {
  const today = todayLagos();
  const { data } = useAsync(async () => {
    const levels = await loadLevels(schoolId);
    const arms = levels.flatMap((l) => l.class_arms.map((a) => ({ ...a, label: `${l.name} ${a.name}` })));
    const mine = seesAll ? arms : arms.filter((a) => a.form_tutor_id === userId);
    const regs = seesAll ? await loadDayRegisters(schoolId, today) : ((await Promise.all(mine.map((a) => loadRegister(schoolId, a.id, today)))).filter(Boolean) as Register[]);
    return { total: mine.length, marked: regs.length, absent: regs.reduce((n, r) => n + (r.counts?.absent ?? 0), 0), pending: mine.filter((a) => !regs.some((r) => r.armId === a.id)).map((a) => a.label) };
  }, [schoolId, seesAll, userId, today]);
  if (!data || data.total === 0 || isWeekend(today)) return null;
  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 font-semibold"><CalendarCheck className="h-4 w-4 text-slate-400" aria-hidden /> Today's attendance</h2>
      <p className="mt-2 text-sm text-slate-700">
        {data.marked} of {data.total} {seesAll ? "classes" : "of your classes"} marked{data.absent ? ` · ${data.absent} absent` : ""}.
      </p>
      {data.pending.length > 0 && <p className="mt-1 text-xs text-slate-500">Waiting: {data.pending.slice(0, 6).join(", ")}{data.pending.length > 6 ? ` and ${data.pending.length - 6} more` : ""}</p>}
      <Link to="/attendance" className="mt-3 inline-block text-sm font-medium text-brand hover:underline">{seesAll ? "Open attendance" : "Take today's register"}</Link>
    </section>
  );
}

function TermCard({ term }: { term: CurrentTerm | null }) {
  if (!term) {
    return (
      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-semibold"><CalendarDays className="h-4 w-4 text-slate-400" aria-hidden /> School calendar</h2>
        <p className="mt-2 text-sm text-slate-600">No current term has been set yet.</p>
      </section>
    );
  }
  const today = todayIso();
  const total = Math.max(1, daysBetween(term.start_date, term.end_date));
  const elapsed = Math.min(total, Math.max(0, daysBetween(term.start_date, today)));
  const left = daysBetween(today, term.end_date);
  const status = today < term.start_date ? `Resumes ${formatDate(term.start_date)}` : left >= 0 ? `${left} day${left === 1 ? "" : "s"} to vacation` : "Term has ended";
  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 font-semibold"><CalendarDays className="h-4 w-4 text-slate-400" aria-hidden /> {term.name}, {term.session_name}</h2>
      <p className="mt-1 text-sm text-slate-500">{formatDate(term.start_date)} to {formatDate(term.end_date)}</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div className="h-full rounded-full bg-accent" style={{ width: `${(elapsed / total) * 100}%` }} />
      </div>
      <p className="mt-2 text-sm font-medium text-slate-700">{status}</p>
      {term.next_term_begins && <p className="text-xs text-slate-500">Next term begins {formatDate(term.next_term_begins)}</p>}
    </section>
  );
}

function SetupChecklist({ schoolId, sessionId }: { schoolId: string; sessionId: string | null }) {
  const { activeSchool } = useAuth();
  const { data } = useAsync(async () => {
    const count = async (name: string, ...filters: ReturnType<typeof where>[]) =>
      (await getCountFromServer(query(collection(db, "schools", schoolId, name), ...filters))).data().count;
    const [school, members, levels, arms, assignments, students] = await Promise.all([
      getDoc(doc(db, "schools", schoolId)),
      getDocs(collection(db, "schools", schoolId, "members")),
      getDocs(collection(db, "schools", schoolId, "classLevels")),
      count("classArms"),
      sessionId ? count("assignments", where("sessionId", "==", sessionId)) : Promise.resolve(0),
      count("students"),
    ]);
    const s = school.data()?.settings ?? {};
    const roles = members.docs.flatMap((m) => (m.data().roles ?? []) as string[]);
    const offerings = levels.docs.some((l) => Object.keys(l.data().subjects ?? {}).length > 0);
    return [
      { done: Boolean(s.address && s.phone && s.email), label: "Add the school's address, phone and email", to: "/settings/school" },
      { done: Boolean(s.hasLogo), label: "Upload the school logo", to: "/settings/school" },
      { done: roles.some((r) => r === "teacher" || r === "bursar"), label: "Invite your bursar and teachers", to: "/settings/staff" },
      { done: Boolean(sessionId), label: "Set up the session and current term", to: "/academics/calendar" },
      { done: arms > 0, label: "Create classes and arms", to: "/academics/classes" },
      { done: offerings, label: "Choose the subjects each class offers", to: "/academics/subjects" },
      { done: assignments > 0, label: "Assign subject teachers", to: "/academics/teachers" },
      { done: students > 0, label: "Add your students (or import from Excel)", to: "/students" },
    ];
  }, [schoolId, sessionId, activeSchool?.logo]);

  if (!data) return null;
  const doneCount = data.filter((i) => i.done).length;
  if (doneCount === data.length) return null;

  return (
    <section className="card p-5 lg:col-span-2" aria-labelledby="setup-title">
      <div className="flex items-center justify-between">
        <h2 id="setup-title" className="font-semibold">Get your school ready</h2>
        <span className="text-sm text-slate-500">{doneCount} of {data.length} done</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(doneCount / data.length) * 100}%` }} />
      </div>
      <ul className="mt-4 grid divide-y divide-slate-100 sm:grid-cols-2 sm:gap-x-8 sm:divide-y-0">
        {data.map((item) => (
          <li key={item.label} className="flex items-center gap-3 py-2.5">
            {item.done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-accent" aria-label="Done" /> : <Circle className="h-5 w-5 shrink-0 text-slate-300" aria-label="Not done" />}
            <span className={`flex-1 text-sm ${item.done ? "text-slate-500 line-through" : "text-slate-800"}`}>{item.label}</span>
            {!item.done && <Link to={item.to} className="text-sm font-medium text-brand hover:underline">Start</Link>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MyClasses({ schoolId, sessionId, userId }: { schoolId: string; sessionId: string; userId: string }) {
  const { data } = useAsync(async () => {
    const [assigned, levels, subjects] = await Promise.all([loadAssignments(schoolId, sessionId, userId), loadLevels(schoolId), loadSubjects(schoolId)]);
    const arms = levels.flatMap((l) => l.class_arms.map((a) => ({ ...a, level: l })));
    const armById = new Map(arms.map((a) => [a.id, a]));
    const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
    return {
      assigned: assigned.map((a) => ({ arm: armById.get(a.class_arm_id), subject: subjectName.get(a.subject_id) ?? "" })).filter((a) => a.arm),
      tutored: arms.filter((a) => a.form_tutor_id === userId).map((a) => `${a.level.name} ${a.name}`),
    };
  }, [schoolId, sessionId, userId]);

  const grouped = useMemo(() => {
    const m = new Map<string, { label: string; order: number; subjects: string[] }>();
    for (const r of data?.assigned ?? []) {
      const arm = r.arm!;
      const g = m.get(arm.id) ?? { label: `${arm.level.name} ${arm.name}`, order: arm.level.order_index, subjects: [] };
      g.subjects.push(r.subject);
      m.set(arm.id, g);
    }
    return [...m.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  }, [data]);

  if (!data) return null;
  return (
    <section className="card p-5">
      <h2 className="font-semibold">My classes</h2>
      {data.tutored.length > 0 && (
        <p className="mt-1 flex flex-wrap items-center gap-1 text-sm text-slate-600">
          Form tutor of {data.tutored.map((t) => <Badge key={t} tone="brand">{t}</Badge>)}
        </p>
      )}
      {grouped.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">You have not been assigned any subjects for this session yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {grouped.map((g) => (
            <li key={g.label} className="flex items-start justify-between gap-3 py-2 text-sm">
              <span className="font-medium">{g.label}</span>
              <span className="text-right text-slate-600">{g.subjects.sort().join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DashboardPage() {
  const { profile, activeSchool, can, roles, currentTerm } = useAuth();
  const firstName = profile?.full_name?.split(" ")[0];
  const isTeacher = roles.includes("teacher");

  return (
    <>
      <PageHeader title={`${greeting()}${firstName ? `, ${firstName}` : ""}`} description={activeSchool?.name} />
      <div className="grid gap-6 lg:grid-cols-2">
        {activeSchool && can(ADMIN_ROLES) && <SetupChecklist schoolId={activeSchool.id} sessionId={currentTerm?.session_id ?? null} />}
        <TermCard term={currentTerm} />
        {activeSchool && currentTerm && profile && (can(["proprietor", "principal", "school_admin", "bursar"]) || isTeacher) && (
          <AttendanceTodayCard schoolId={activeSchool.id} seesAll={can(["proprietor", "principal", "school_admin", "bursar"])} userId={profile.id} />
        )}
        {activeSchool && isTeacher && currentTerm && profile && <MyClasses schoolId={activeSchool.id} sessionId={currentTerm.session_id} userId={profile.id} />}
        <section className="card p-5">
          <h2 className="font-semibold">What's coming next</h2>
          <p className="mt-2 text-sm text-slate-600">
            Results and fees are being added step by step. Menu items marked
            <span className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">Soon</span>
            will switch on as each one is ready.
          </p>
        </section>
      </div>
    </>
  );
}
