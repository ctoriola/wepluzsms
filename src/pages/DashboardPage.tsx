import { collection, doc, getCountFromServer, getDoc, getDocs, query, where } from "firebase/firestore";
import { ArrowUpRight, BookOpen, CalendarCheck, CalendarDays, CheckCircle2, Circle, ClipboardList, GraduationCap, HeartHandshake, ListChecks, UserPlus, Users } from "lucide-react";
import { useMemo, useState, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { useAuth, type CurrentTerm } from "@/auth/AuthProvider";
import { BarChart, LineChart } from "@/components/charts";
import { Badge, CardTitle, IconChip } from "@/components/ui";
import { loadAssignments, loadLevels, loadSubjects } from "@/lib/academics";
import { api } from "@/lib/api";
import { isWeekend, loadDayRegisters, loadRegister, todayLagos, type Register } from "@/lib/attendance";
import { daysBetween, formatDate, useAsync } from "@/lib/data";
import { db } from "@/lib/firebase";
import { ADMIN_ROLES, STAFF_ROLES } from "@/lib/roles";
import { fullName, loadMyChildren } from "@/lib/students";
import { StudentAvatar } from "./students/common";

const SEES_ALL = ["proprietor", "principal", "school_admin", "bursar"] as const;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** School days (weekdays, not holidays) of the term up to today, newest last. */
function recentSchoolDays(start: string, end: string, holidays: string[], today: string, count: number) {
  const days: string[] = [];
  const stop = today < end ? today : end;
  for (let t = Date.parse(`${stop}T12:00:00Z`); t >= Date.parse(`${start}T12:00:00Z`) && days.length < count; t -= 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (!isWeekend(d) && !holidays.includes(d)) days.unshift(d);
  }
  return days;
}

// ------------------------------------------------------------------ hero + term
type Action = { label: string; to: string; icon: ComponentType<{ className?: string }> };

function Hero({ name, school, actions }: { name: string; school: string; actions: Action[] }) {
  return (
    <section className="card flex flex-col gap-6 p-6 lg:col-span-2 xl:flex-row xl:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-500">{school}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
          {greeting()}
          {name ? `, ${name}` : ""}
        </h1>
        <p className="mt-2 text-sm text-slate-500">{formatDate(todayLagos(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      </div>
      {actions.length > 0 && (
        <div>
          <p className="mb-2 text-sm text-slate-500">What would you like to do?</p>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {actions.map((a) => (
              <Link key={a.to} to={a.to} className="group flex min-w-0 flex-col items-center justify-between gap-3 rounded-2xl bg-brand/10 p-3 text-center transition hover:bg-brand/15 sm:aspect-square sm:w-28">
                <IconChip icon={a.icon} size={38} />
                <span className="text-xs font-semibold leading-tight text-ink sm:text-sm">{a.label}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function TermCard({ term }: { term: CurrentTerm | null }) {
  if (!term) {
    return (
      <section className="card p-6">
        <CardTitle icon={CalendarDays} title="School calendar" />
        <p className="text-sm text-slate-600">No current term has been set yet.</p>
      </section>
    );
  }
  const today = todayLagos();
  const total = Math.max(1, daysBetween(term.start_date, term.end_date));
  const elapsed = Math.min(total, Math.max(0, daysBetween(term.start_date, today)));
  const left = daysBetween(today, term.end_date);
  return (
    <section className="card flex flex-col p-6">
      <CardTitle icon={CalendarDays} title={term.name} action={<Badge tone="brand">{term.session_name}</Badge>} />
      <p className="text-4xl font-semibold tracking-tight">{today < term.start_date ? "Not started" : left >= 0 ? left : 0}</p>
      <p className="text-sm text-slate-500">{today < term.start_date ? `Resumes ${formatDate(term.start_date)}` : left >= 0 ? "days to vacation" : "Term has ended"}</p>
      <div className="mt-auto pt-5">
        <div className="h-2.5 overflow-hidden rounded-full bg-white" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((elapsed / total) * 100)} aria-label="Term progress">
          <div className="h-full rounded-full bg-accent" style={{ width: `${(elapsed / total) * 100}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-xs text-slate-500">
          <span>{formatDate(term.start_date, { day: "numeric", month: "short" })}</span>
          <span>{formatDate(term.end_date, { day: "numeric", month: "short" })}</span>
        </div>
        {term.next_term_begins && <p className="mt-2 text-xs text-slate-500">Next term begins {formatDate(term.next_term_begins)}</p>}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ leadership widgets
function SchoolStats({ schoolId, term }: { schoolId: string; term: CurrentTerm }) {
  const [asTable, setAsTable] = useState(false);
  const { data } = useAsync(async () => {
    const students = collection(db, "schools", schoolId, "students");
    const count = async (...f: ReturnType<typeof where>[]) => (await getCountFromServer(query(students, where("status", "==", "active"), ...f))).data().count;
    const [levels, termDoc] = await Promise.all([loadLevels(schoolId), getDoc(doc(db, "schools", schoolId, "terms", term.id))]);
    const arms = levels.flatMap((l) => l.class_arms.map((a) => ({ id: a.id, label: `${l.name.replace(/^Primary\s*/, "P").replace(/^(JSS|SSS|SS)\s+/, "$1")} ${a.name}` })));
    const holidays = ((termDoc.data()?.holidays ?? []) as { date: string }[]).map((h) => h.date);
    const days = recentSchoolDays(term.start_date, term.end_date, holidays, todayLagos(), 10);
    const [total, girls, perArm, registersByDay] = await Promise.all([
      count(),
      count(where("gender", "==", "female")),
      Promise.all(arms.map(async (a) => ({ label: a.label, value: await count(where("currentArmId", "==", a.id)) }))),
      Promise.all(days.map((d) => loadDayRegisters(schoolId, d))),
    ]);
    const trend = days.map((d, i) => {
      const regs = registersByDay[i];
      const all = regs.reduce((n, r) => n + Object.values(r.counts ?? {}).reduce((a, b) => a + b, 0), 0);
      const here = regs.reduce((n, r) => n + (r.counts?.present ?? 0) + (r.counts?.late ?? 0), 0);
      return { label: formatDate(d, { day: "numeric", month: "short" }), value: all ? Math.round((here / all) * 1000) / 10 : null, detail: regs.length ? `${regs.length} of ${arms.length} classes marked` : "No registers" };
    });
    const today = registersByDay[days.length - 1] && days[days.length - 1] === todayLagos() ? registersByDay[days.length - 1] : [];
    return {
      total,
      girls,
      perArm: perArm.filter((a) => a.value > 0),
      trend,
      today: { marked: today.length, classes: arms.length, absent: today.reduce((n, r) => n + (r.counts?.absent ?? 0), 0) },
    };
  }, [schoolId, term.id]);

  const latest = useMemo(() => [...(data?.trend ?? [])].reverse().find((p) => p.value !== null), [data]);

  if (!data) return <section className="card h-64 animate-pulse lg:col-span-3" aria-busy="true" />;
  return (
    <>
      <section className="card flex flex-col p-6">
        <CardTitle icon={Users} title="Students" action={<Link to="/students" className="text-sm font-medium text-brand hover:underline">View all</Link>} />
        <p className="text-4xl font-semibold tracking-tight">{data.total}</p>
        <p className="text-xs text-slate-500">active this session</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone="brand">{data.girls} girls</Badge>
          <Badge tone="slate">{data.total - data.girls} boys</Badge>
        </div>
        <dl className="mt-auto grid grid-cols-2 gap-2 pt-5 text-sm">
          <div className="rounded-2xl bg-white px-4 py-3"><dt className="text-xs text-slate-500">Classes</dt><dd className="text-lg font-semibold">{data.perArm.length}</dd></div>
          <div className="rounded-2xl bg-white px-4 py-3"><dt className="text-xs text-slate-500">Average size</dt><dd className="text-lg font-semibold">{data.perArm.length ? Math.round(data.total / data.perArm.length) : 0}</dd></div>
        </dl>
      </section>
      <section className="card flex flex-col p-6">
        <CardTitle icon={CalendarCheck} title="Attendance" action={<Link to="/attendance" className="text-sm font-medium text-brand hover:underline">Open</Link>} />
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-4xl font-semibold tracking-tight">{latest?.value ?? "-"}{latest?.value !== undefined && latest?.value !== null && "%"}</p>
            <p className="text-xs text-slate-500">{latest ? `Present on ${latest.label}` : "No registers yet"}</p>
          </div>
          <Badge tone={data.today.marked === data.today.classes ? "green" : "amber"}>{data.today.marked}/{data.today.classes} marked today</Badge>
        </div>
        <div className="mt-4">
          <LineChart points={data.trend} max={100} format={(v) => `${v}%`} height={80} title="Attendance rate, last 10 school days" />
        </div>
      </section>
      <section className="card flex flex-col p-6">
        <CardTitle
          icon={ListChecks}
          title="Today"
          action={<Badge tone={data.today.absent ? "red" : "green"}>{data.today.absent} absent</Badge>}
        />
        <ul className="space-y-3 text-sm">
          <li className="flex items-center justify-between rounded-2xl bg-white px-4 py-3"><span className="text-slate-600">Classes marked</span><span className="font-semibold">{data.today.marked} of {data.today.classes}</span></li>
          <li className="flex items-center justify-between rounded-2xl bg-white px-4 py-3"><span className="text-slate-600">Students absent</span><span className="font-semibold">{data.today.absent}</span></li>
          <li className="flex items-center justify-between rounded-2xl bg-white px-4 py-3"><span className="text-slate-600">Active students</span><span className="font-semibold">{data.total}</span></li>
        </ul>
        <Link to="/attendance" className="mt-4 flex items-center justify-center gap-1 rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand/90 lg:mt-auto">
          See every class <ArrowUpRight className="h-4 w-4" aria-hidden />
        </Link>
      </section>
      <section className="card p-6 lg:col-span-3">
        <CardTitle
          icon={GraduationCap}
          title="Students per class"
          action={
            <button onClick={() => setAsTable(!asTable)} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:text-ink" aria-pressed={asTable}>
              {asTable ? "Chart" : "Table"}
            </button>
          }
        />
        {data.perArm.length ? <BarChart bars={data.perArm} unit="students" title="Active students per class" asTable={asTable} /> : <p className="text-sm text-slate-500">No students in classes yet.</p>}
      </section>
    </>
  );
}

function SetupChecklist({ schoolId, sessionId }: { schoolId: string; sessionId: string | null }) {
  const { activeSchool } = useAuth();
  const { data } = useAsync(async () => {
    const count = async (name: string, ...filters: ReturnType<typeof where>[]) => (await getCountFromServer(query(collection(db, "schools", schoolId, name), ...filters))).data().count;
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
    return [
      { done: Boolean(s.address && s.phone && s.email), label: "Add the school's address, phone and email", to: "/settings/school" },
      { done: Boolean(s.hasLogo), label: "Upload the school logo", to: "/settings/school" },
      { done: roles.some((r) => r === "teacher" || r === "bursar"), label: "Invite your bursar and teachers", to: "/settings/staff" },
      { done: Boolean(sessionId), label: "Set up the session and current term", to: "/academics/calendar" },
      { done: arms > 0, label: "Create classes and arms", to: "/academics/classes" },
      { done: levels.docs.some((l) => Object.keys(l.data().subjects ?? {}).length > 0), label: "Choose the subjects each class offers", to: "/academics/subjects" },
      { done: assignments > 0, label: "Assign subject teachers", to: "/academics/teachers" },
      { done: students > 0, label: "Add your students (or import from Excel)", to: "/students" },
    ];
  }, [schoolId, sessionId, activeSchool?.logo]);

  if (!data) return null;
  const doneCount = data.filter((i) => i.done).length;
  if (doneCount === data.length) return null;
  return (
    <section className="card p-6 lg:col-span-3">
      <CardTitle icon={ClipboardList} title="Get your school ready" action={<span className="text-sm text-slate-500">{doneCount} of {data.length} done</span>} />
      <div className="h-2.5 overflow-hidden rounded-full bg-white">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(doneCount / data.length) * 100}%` }} />
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {data.map((item) => (
          <li key={item.label} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3">
            {item.done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-brand" aria-label="Done" /> : <Circle className="h-5 w-5 shrink-0 text-slate-300" aria-label="Not done" />}
            <span className={`flex-1 text-sm ${item.done ? "text-slate-400 line-through" : "text-ink"}`}>{item.label}</span>
            {!item.done && <Link to={item.to} className="text-sm font-semibold text-brand hover:underline">Start</Link>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ teacher widgets
function MyClasses({ schoolId, sessionId, userId }: { schoolId: string; sessionId: string; userId: string }) {
  const { data } = useAsync(async () => {
    const today = todayLagos();
    const [assigned, levels, subjects] = await Promise.all([loadAssignments(schoolId, sessionId, userId), loadLevels(schoolId), loadSubjects(schoolId)]);
    const arms = levels.flatMap((l) => l.class_arms.map((a) => ({ ...a, label: `${l.name} ${a.name}`, order: l.order_index })));
    const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
    const tutored = arms.filter((a) => a.form_tutor_id === userId);
    const registers = (await Promise.all(tutored.map((a) => loadRegister(schoolId, a.id, today)))).filter(Boolean) as Register[];
    const grouped = new Map<string, { label: string; order: number; subjects: string[] }>();
    for (const a of assigned) {
      const arm = arms.find((x) => x.id === a.class_arm_id);
      if (!arm) continue;
      const g = grouped.get(arm.id) ?? { label: arm.label, order: arm.order, subjects: [] };
      g.subjects.push(subjectName.get(a.subject_id) ?? "");
      grouped.set(arm.id, g);
    }
    return {
      classes: [...grouped.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)),
      tutored: tutored.map((a) => ({ ...a, marked: registers.some((r) => r.armId === a.id) })),
      schoolDay: !isWeekend(today),
    };
  }, [schoolId, sessionId, userId]);

  if (!data) return <section className="card h-48 animate-pulse lg:col-span-3" aria-busy="true" />;
  return (
    <>
      <section className="card p-6 lg:col-span-2">
        <CardTitle icon={BookOpen} title="My classes" action={<Link to="/students" className="text-sm font-medium text-brand hover:underline">My students</Link>} />
        {data.classes.length === 0 ? (
          <p className="text-sm text-slate-500">You have not been assigned any subjects for this session yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.classes.map((g) => (
              <li key={g.label} className="rounded-2xl bg-white px-4 py-3">
                <p className="font-semibold">{g.label}</p>
                <p className="text-sm text-slate-500">{g.subjects.sort().join(", ")}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card flex flex-col p-6">
        <CardTitle icon={CalendarCheck} title="Today's register" />
        {data.tutored.length === 0 ? (
          <p className="text-sm text-slate-500">You are not a form tutor, so you have no register to take.</p>
        ) : (
          <ul className="space-y-2">
            {data.tutored.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded-2xl bg-white px-4 py-3">
                <span className="font-semibold">{a.label}</span>
                {a.marked ? <Badge tone="green">Marked</Badge> : <Badge tone="amber">Pending</Badge>}
              </li>
            ))}
          </ul>
        )}
        {data.tutored.length > 0 && data.schoolDay && (
          <Link to="/attendance" className="mt-4 flex items-center justify-center gap-1 rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand/90">
            {data.tutored.every((a) => a.marked) ? "Review register" : "Take today's register"} <ArrowUpRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </section>
    </>
  );
}

// ------------------------------------------------------------------ parent widgets
type Summary = { rate: number | null; absent: number; late: number };

function MyChildren({ schoolId, userId }: { schoolId: string; userId: string }) {
  const { data } = useAsync(async () => {
    const [children, levels] = await Promise.all([loadMyChildren(schoolId, userId), loadLevels(schoolId)]);
    const arms = new Map(levels.flatMap((l) => l.class_arms.map((a) => [a.id, `${l.name} ${a.name}`] as const)));
    const summaries = await Promise.all(children.map((c) => api<Summary>("attendance.studentSummary", { schoolId, studentId: c.id }).catch(() => null)));
    return children.map((c, i) => ({ child: c, arm: arms.get(c.currentArmId ?? "") ?? "No class this session", summary: summaries[i] }));
  }, [schoolId, userId]);

  if (!data) return <section className="card h-40 animate-pulse lg:col-span-3" aria-busy="true" />;
  return (
    <section className="card p-6 lg:col-span-3">
      <CardTitle icon={HeartHandshake} title="My children" action={<Link to="/parent/children" className="text-sm font-medium text-brand hover:underline">View all</Link>} />
      {data.length === 0 && <p className="text-sm text-slate-500">No children linked yet. Ask the school office to link your child to your account.</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {data.map(({ child, arm, summary }) => (
          <li key={child.id}>
            <Link to={`/students/${child.id}`} className="flex items-center gap-4 rounded-2xl bg-white p-4 hover:ring-2 hover:ring-brand/20">
              <StudentAvatar student={child} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{fullName(child)}</p>
                <p className="text-sm text-slate-500">{arm}</p>
              </div>
              {summary?.rate !== null && summary?.rate !== undefined && (
                <div className="text-right">
                  <p className="text-xl font-semibold">{summary.rate}%</p>
                  <p className="text-[11px] text-slate-500">attendance</p>
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ page
export function DashboardPage() {
  const { profile, activeSchool, can, roles, currentTerm } = useAuth();
  const firstName = (profile?.full_name ?? "").replace(/^(mr|mrs|ms|miss|dr|prof|chief|engr|pastor|alhaji|alhaja)\.?\s+/i, "").split(" ")[0] ?? "";
  const seesAll = can([...SEES_ALL]);
  const isTeacher = roles.includes("teacher");
  const isParent = roles.includes("parent");

  const actions: Action[] = can(ADMIN_ROLES)
    ? [
        { label: "Add student", to: "/students", icon: UserPlus },
        { label: "Attendance", to: "/attendance", icon: CalendarCheck },
        { label: "Invite staff", to: "/settings/staff", icon: Users },
      ]
    : isTeacher
      ? [
          { label: "Take register", to: "/attendance", icon: CalendarCheck },
          { label: "My students", to: "/students", icon: Users },
          ...(isParent ? [{ label: "My children", to: "/parent/children", icon: HeartHandshake }] : []),
        ]
      : can(STAFF_ROLES)
        ? [
            { label: "Students", to: "/students", icon: Users },
            { label: "Attendance", to: "/attendance", icon: CalendarCheck },
          ]
        : isParent
          ? [{ label: "My children", to: "/parent/children", icon: HeartHandshake }]
          : [];

  if (!activeSchool) return null;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 [&>*]:min-w-0">
      <Hero name={firstName} school={activeSchool.name} actions={actions} />
      <TermCard term={currentTerm} />
      {can(ADMIN_ROLES) && <SetupChecklist schoolId={activeSchool.id} sessionId={currentTerm?.session_id ?? null} />}
      {seesAll && currentTerm && <SchoolStats schoolId={activeSchool.id} term={currentTerm} />}
      {isTeacher && currentTerm && profile && <MyClasses schoolId={activeSchool.id} sessionId={currentTerm.session_id} userId={profile.id} />}
      {isParent && profile && <MyChildren schoolId={activeSchool.id} userId={profile.id} />}
    </div>
  );
}
