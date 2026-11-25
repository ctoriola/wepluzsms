import { doc, getDoc } from "firebase/firestore";
import { CalendarCheck, CloudOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Badge, Button, EmptyState, Field, FullPageSpinner, PageHeader } from "@/components/ui";
import { loadLevels } from "@/lib/academics";
import { api, friendlyError } from "@/lib/api";
import { flushQueue, isWeekend, loadDayRegisters, loadRegister, queued, todayLagos, type Register } from "@/lib/attendance";
import { formatDate, useAsync } from "@/lib/data";
import { db } from "@/lib/firebase";
import { ADMIN_ROLES } from "@/lib/roles";
import { armOptions } from "../students/common";

export function AttendancePage() {
  const { activeSchool, can, profile, currentTerm } = useAuth();
  const sid = activeSchool!.id;
  const isAdmin = can(ADMIN_ROLES);
  const seesAll = can(["proprietor", "principal", "school_admin", "bursar"]);
  const today = todayLagos();
  const [date, setDate] = useState(today);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [pending, setPending] = useState(queued().length);

  useEffect(() => {
    const notice = sessionStorage.getItem("wepluz.attendanceNotice");
    if (notice) {
      sessionStorage.removeItem("wepluz.attendanceNotice");
      setMsg({ tone: notice.startsWith("No internet") ? "info" : "success", text: notice });
      setPending(queued().length);
    }
  }, []);

  const data = useAsync(async () => {
    const levels = await loadLevels(sid);
    const arms = armOptions(levels);
    const mine = seesAll ? arms : arms.filter((a) => levels.some((l) => l.class_arms.some((x) => x.id === a.id && x.form_tutor_id === profile?.id)));
    const registers = seesAll ? await loadDayRegisters(sid, date) : (await Promise.all(mine.map((a) => loadRegister(sid, a.id, date)))).filter(Boolean) as Register[];
    const term = currentTerm ? (await getDoc(doc(db, "schools", sid, "terms", currentTerm.id))).data() : null;
    return { arms: mine, registers: new Map(registers.map((r) => [r.armId, r])), holidays: (term?.holidays ?? []) as { date: string; label: string }[] };
  }, [sid, date, seesAll, profile?.id, currentTerm?.id]);

  useEffect(() => {
    const send = async () => {
      if (!queued().length) return;
      const r = await flushQueue();
      setPending(queued().length);
      if (r.sent) setMsg({ tone: "success", text: `${r.sent} register${r.sent > 1 ? "s" : ""} saved on this phone ${r.sent > 1 ? "were" : "was"} sent.` });
      if (r.failed.length) setMsg({ tone: "error", text: r.failed.map((f) => `${f.label}: ${f.error}`).join(" ") });
      void data.reload();
    };
    void send();
    window.addEventListener("online", send);
    return () => window.removeEventListener("online", send);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const holiday = data.data?.holidays.find((h) => h.date === date);
  const stats = useMemo(() => {
    const regs = [...(data.data?.registers.values() ?? [])];
    const present = regs.reduce((n, r) => n + (r.counts?.present ?? 0) + (r.counts?.late ?? 0), 0);
    const total = regs.reduce((n, r) => n + Object.values(r.counts ?? {}).reduce((a, b) => a + b, 0), 0);
    return { marked: regs.length, absent: regs.reduce((n, r) => n + (r.counts?.absent ?? 0), 0), rate: total ? Math.round((present / total) * 100) : null };
  }, [data.data]);

  async function toggleHoliday() {
    const label = holiday ? null : window.prompt("Holiday name (e.g. Mid-term break)", "Public holiday");
    if (!holiday && !label) return;
    try {
      await api("attendance.setHoliday", { schoolId: sid, date, label });
      setMsg({ tone: "success", text: holiday ? "Holiday removed." : `${formatDate(date)} is now a school holiday.` });
      await data.reload();
    } catch (err) {
      setMsg({ tone: "error", text: friendlyError(err) });
    }
  }

  if (!currentTerm) return <EmptyState title="Set the current term first">Attendance is taken for the current term (Sessions & terms).</EmptyState>;
  if (data.loading && !data.data) return <FullPageSpinner />;
  const closed = isWeekend(date) ? "Weekend" : holiday ? `Holiday: ${holiday.label}` : date < currentTerm.start_date || date > currentTerm.end_date ? "Outside the current term" : null;

  return (
    <>
      <PageHeader title="Attendance" description={`${formatDate(date, { weekday: "long", day: "numeric", month: "long" })} · ${currentTerm.name}`} />
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {pending > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">{pending} register{pending > 1 ? "s are" : " is"} saved on this phone and will be sent when you are back online.</span>
        </div>
      )}
      {data.error && <div className="mb-4"><Alert>{data.error}</Alert></div>}

      {seesAll && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Date" htmlFor="att-date">
            <input id="att-date" type="date" className="input sm:w-48" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          {isAdmin && !isWeekend(date) && date >= currentTerm.start_date && date <= currentTerm.end_date && (
            <Button variant="secondary" onClick={() => void toggleHoliday()}>{holiday ? "Not a holiday" : "Mark as holiday"}</Button>
          )}
          <div className="grid flex-1 grid-cols-3 gap-2 sm:ml-auto sm:max-w-md">
            <div className="card p-3"><p className="text-lg font-bold">{stats.marked}/{data.data?.arms.length}</p><p className="text-xs text-slate-500">Classes marked</p></div>
            <div className="card p-3"><p className="text-lg font-bold">{stats.rate ?? "-"}{stats.rate !== null && "%"}</p><p className="text-xs text-slate-500">Present</p></div>
            <div className="card p-3"><p className="text-lg font-bold">{stats.absent}</p><p className="text-xs text-slate-500">Absent</p></div>
          </div>
        </div>
      )}

      {closed ? (
        <EmptyState title="No school today">{closed}</EmptyState>
      ) : data.data?.arms.length === 0 ? (
        <EmptyState title="No register to take">You take the register for classes where you are the form tutor. Ask a school admin to set you as form tutor under Classes & arms.</EmptyState>
      ) : (
        <div className="card divide-y divide-slate-100">
          {data.data?.arms.map((a) => {
            const r = data.data!.registers.get(a.id);
            const canTake = isAdmin || date === today;
            return (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                <CalendarCheck className={`h-5 w-5 shrink-0 ${r ? "text-brand" : "text-slate-300"}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{a.label}</p>
                  <p className="text-xs text-slate-500">
                    {r ? `${r.counts.present} present · ${r.counts.absent} absent · ${r.counts.late} late${r.counts.excused ? ` · ${r.counts.excused} excused` : ""}` : "Not marked yet"}
                  </p>
                </div>
                {r ? <Badge tone="green">Marked</Badge> : <Badge tone="amber">Pending</Badge>}
                {canTake && (
                  <Link to={`/attendance/${a.id}/${date}`}>
                    <Button variant={r ? "secondary" : "primary"}>{r ? "Edit" : "Take register"}</Button>
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
