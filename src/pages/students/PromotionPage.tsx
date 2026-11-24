import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Badge, Button, EmptyState, Field, FullPageSpinner, PageHeader } from "@/components/ui";
import { loadSessions } from "@/lib/academics";
import { api, friendlyError } from "@/lib/api";
import { useAsync } from "@/lib/data";

type Plan = {
  from: string;
  to: string;
  promote: number;
  repeat: number;
  graduate: number;
  skipped: number;
  problems: string[];
  moves: { from: string; to: string; count: number }[];
  students: { studentId: string; name: string; fromLevel: string; toLabel: string; action: "promote" | "repeat" | "graduate" }[];
  saved: boolean;
};

export function PromotionPage() {
  const { activeSchool, currentTerm } = useAuth();
  const sid = activeSchool!.id;
  const sessions = useAsync(() => loadSessions(sid), [sid]);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [exceptions, setExceptions] = useState<Record<string, "repeat" | "graduate">>({});
  const [plan, setPlan] = useState<Plan | null>(null);
  const [result, setResult] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<"plan" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const from = fromId || currentTerm?.session_id || "";
  const ordered = useMemo(() => [...(sessions.data ?? [])].sort((a, b) => a.start_date.localeCompare(b.start_date)), [sessions.data]);
  const fromSession = ordered.find((s) => s.id === from);
  const later = ordered.filter((s) => fromSession && s.start_date > fromSession.start_date);
  const to = toId || later[0]?.id || "";

  async function preview(ex = exceptions) {
    setBusy("plan");
    setError(null);
    setResult(null);
    try {
      setPlan(await api<Plan>("promotion.run", { schoolId: sid, fromSessionId: from, toSessionId: to, dryRun: true, exceptions: ex }));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    if (!plan || !window.confirm(`Promote ${plan.promote}, keep back ${plan.repeat} and graduate ${plan.graduate} students into ${plan.to}?`)) return;
    setBusy("run");
    setError(null);
    try {
      setResult(await api<Plan>("promotion.run", { schoolId: sid, fromSessionId: from, toSessionId: to, dryRun: false, exceptions }));
      setPlan(null);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  function setException(studentId: string, value: "" | "repeat" | "graduate") {
    const next = { ...exceptions };
    if (value) next[studentId] = value;
    else delete next[studentId];
    setExceptions(next);
    void preview(next);
  }

  if (sessions.loading && !sessions.data) return <FullPageSpinner />;

  const shown = (plan?.students ?? []).filter((s) => !filter || `${s.name} ${s.fromLevel}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <Link to="/students" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Students</Link>
      <PageHeader title="End-of-session promotion" description="Move every student up to their next class for the new session. You review everything before anything is saved." />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      {result && (
        <div className="card mb-6 p-5">
          <p className="flex items-center gap-2 font-semibold text-emerald-700"><CheckCircle2 className="h-5 w-5" aria-hidden /> Promotion saved</p>
          <p className="mt-2 text-sm text-slate-700">
            {result.promote} promoted, {result.repeat} kept back, {result.graduate} graduated into {result.to}.
            {currentTerm?.session_id !== to && " Nothing changes for this session: students move into their new classes, and leavers graduate, when you make a term of the new session current (Sessions & terms)."}
          </p>
        </div>
      )}

      {later.length === 0 && fromSession ? (
        <EmptyState title="Create next session first">
          Add the next session (and its first term) under <Link to="/academics/calendar" className="font-medium text-brand hover:underline">Sessions & terms</Link>, then come back here.
        </EmptyState>
      ) : (
        <section className="card mb-6 p-5">
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr_auto]">
            <Field label="From session" htmlFor="p-from">
              <select id="p-from" className="input" value={from} onChange={(e) => { setFromId(e.target.value); setToId(""); setPlan(null); }}>
                {ordered.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <ArrowRight className="mb-3 hidden h-5 w-5 text-slate-400 sm:block" aria-hidden />
            <Field label="To session" htmlFor="p-to">
              <select id="p-to" className="input" value={to} onChange={(e) => { setToId(e.target.value); setPlan(null); }}>
                {later.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Button loading={busy === "plan"} onClick={() => void preview()} disabled={!from || !to}>Preview</Button>
          </div>
        </section>
      )}

      {plan && (
        <>
          {plan.problems.length > 0 && <div className="mb-4"><Alert>{plan.problems.join(" ")}</Alert></div>}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Promoted", plan.promote], ["Kept back", plan.repeat], ["Graduating", plan.graduate], ["Already done", plan.skipped]].map(([label, n]) => (
              <div key={label as string} className="card p-4">
                <p className="text-2xl font-bold">{n}</p>
                <p className="text-sm text-slate-500">{label}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card p-5">
              <h2 className="font-semibold">Class moves</h2>
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {plan.moves.map((m) => (
                  <li key={`${m.from}-${m.to}`} className="flex items-center gap-2 py-2">
                    <span className="w-24 font-medium">{m.from}</span>
                    <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden />
                    <span className="flex-1">{m.to}</span>
                    <Badge>{m.count}</Badge>
                  </li>
                ))}
              </ul>
            </section>
            <section className="card p-5">
              <h2 className="font-semibold">Exceptions</h2>
              <p className="mt-1 text-sm text-slate-500">Keep a student back in the same class, or graduate them early.</p>
              <input className="input mt-3" placeholder="Search a student or class" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <ul className="mt-2 max-h-80 divide-y divide-slate-100 overflow-y-auto text-sm">
                {shown.slice(0, 200).map((s) => (
                  <li key={s.studentId} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 truncate">{s.name} <span className="text-slate-500">· {s.fromLevel} → {s.toLabel}</span></span>
                    <select aria-label={`What happens to ${s.name}`} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs" value={exceptions[s.studentId] ?? ""} onChange={(e) => setException(s.studentId, e.target.value as "" | "repeat" | "graduate")}>
                      <option value="">Normal</option>
                      <option value="repeat">Keep back</option>
                      <option value="graduate">Graduate</option>
                    </select>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <div className="mt-6 flex justify-end">
            <Button loading={busy === "run"} disabled={plan.problems.length > 0 || plan.promote + plan.repeat + plan.graduate === 0} onClick={() => void run()}>
              Save promotion
            </Button>
          </div>
        </>
      )}
    </>
  );
}
