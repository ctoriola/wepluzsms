import { CalendarDays, CheckCircle2, Circle } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth, type CurrentTerm } from "@/auth/AuthProvider";
import { Badge, PageHeader } from "@/components/ui";
import { daysBetween, formatDate, must, todayIso, useAsync } from "@/lib/data";
import { ADMIN_ROLES } from "@/lib/roles";
import { supabase } from "@/lib/supabase";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
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
  const { data } = useAsync(async () => {
    const count = async (table: string) => {
      const { count } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("school_id", schoolId);
      return count ?? 0;
    };
    const [settings, members, arms, offerings, assignments] = await Promise.all([
      supabase.from("school_settings").select("address, phone, email, logo_path").eq("school_id", schoolId).maybeSingle(),
      supabase.from("school_memberships").select("role").eq("school_id", schoolId).eq("status", "active"),
      count("class_arms"),
      count("class_subjects"),
      sessionId
        ? supabase.from("teacher_assignments").select("id", { count: "exact", head: true }).eq("school_id", schoolId).eq("session_id", sessionId).then((r) => r.count ?? 0)
        : Promise.resolve(0),
    ]);
    const s = settings.data;
    const roles = (members.data ?? []).map((m) => m.role as string);
    return [
      { done: Boolean(s?.address && s?.phone && s?.email), label: "Add the school's address, phone and email", to: "/settings/school" },
      { done: Boolean(s?.logo_path), label: "Upload the school logo", to: "/settings/school" },
      { done: roles.some((r) => r === "teacher" || r === "bursar"), label: "Invite your bursar and teachers", to: "/settings/staff" },
      { done: Boolean(sessionId), label: "Set up the session and current term", to: "/academics/calendar" },
      { done: arms > 0, label: "Create classes and arms", to: "/academics/classes" },
      { done: offerings > 0, label: "Choose the subjects each class offers", to: "/academics/subjects" },
      { done: assignments > 0, label: "Assign subject teachers", to: "/academics/teachers" },
    ];
  }, [schoolId, sessionId]);

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

type MyClassRow = { subject_id: string; class_arm_id: string; subjects: { name: string } | null; class_arms: { name: string; class_levels: { name: string; order_index: number } | null } | null };

function MyClasses({ schoolId, sessionId, userId }: { schoolId: string; sessionId: string; userId: string }) {
  const { data } = useAsync(async () => {
    const [assigned, tutored] = await Promise.all([
      supabase
        .from("teacher_assignments")
        .select("subject_id, class_arm_id, subjects(name), class_arms(name, class_levels(name, order_index))")
        .eq("school_id", schoolId)
        .eq("session_id", sessionId)
        .eq("teacher_id", userId),
      supabase.from("class_arms").select("id, name, class_levels(name)").eq("school_id", schoolId).eq("form_tutor_id", userId),
    ]);
    return {
      assigned: must(assigned) as unknown as MyClassRow[],
      tutored: (must(tutored) as unknown as { id: string; name: string; class_levels: { name: string } | null }[]).map((a) => `${a.class_levels?.name ?? ""} ${a.name}`),
    };
  }, [schoolId, sessionId, userId]);

  const grouped = useMemo(() => {
    const m = new Map<string, { label: string; order: number; subjects: string[] }>();
    for (const r of data?.assigned ?? []) {
      const label = `${r.class_arms?.class_levels?.name ?? ""} ${r.class_arms?.name ?? ""}`;
      const g = m.get(r.class_arm_id) ?? { label, order: r.class_arms?.class_levels?.order_index ?? 0, subjects: [] };
      g.subjects.push(r.subjects?.name ?? "");
      m.set(r.class_arm_id, g);
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
        {activeSchool && isTeacher && currentTerm && profile && <MyClasses schoolId={activeSchool.id} sessionId={currentTerm.session_id} userId={profile.id} />}
        <section className="card p-5">
          <h2 className="font-semibold">What's coming next</h2>
          <p className="mt-2 text-sm text-slate-600">
            Student records, attendance, results and fees are being added step by step. Menu items marked
            <span className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">Soon</span>
            will switch on as each one is ready.
          </p>
        </section>
      </div>
    </>
  );
}
