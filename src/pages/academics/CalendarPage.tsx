import { CalendarPlus, Pencil, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Badge, Button, EmptyState, Field, FullPageSpinner, Modal, PageHeader } from "@/components/ui";
import { loadSessions, suggestSession, suggestTerm, type AcademicSession, type Term } from "@/lib/academics";
import { formatDate, useAsync } from "@/lib/data";
import { api, friendlyError } from "@/lib/api";

type SessionForm = { id?: string; name: string; start_date: string; end_date: string };
type TermForm = { id?: string; session: AcademicSession; term_number: number; name: string; start_date: string; end_date: string; next_term_begins: string };

function SessionModal({ schoolId, initial, onClose, onSaved }: { schoolId: string; initial: SessionForm; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{4}\/\d{4}$/.test(form.name)) return setError("Write the session like 2026/2027.");
    if (form.end_date <= form.start_date) return setError("The session must end after it starts.");
    setBusy(true);
    setError(null);
    try {
      const values = { schoolId, name: form.name, startDate: form.start_date, endDate: form.end_date };
      await (form.id ? api("sessions.update", { ...values, id: form.id }) : api("sessions.create", values));
      onSaved();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={form.id ? "Edit session" : "New session"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Session" htmlFor="s-name" hint="For example 2026/2027">
          <input id="s-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts" htmlFor="s-start">
            <input id="s-start" type="date" className="input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </Field>
          <Field label="Ends" htmlFor="s-end">
            <input id="s-end" type="date" className="input" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Save session</Button>
        </div>
      </form>
    </Modal>
  );
}

function TermModal({ schoolId, initial, onClose, onSaved }: { schoolId: string; initial: TermForm; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = form.session;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.end_date <= form.start_date) return setError("The term must end after it starts.");
    if (form.start_date < s.start_date || form.end_date > s.end_date) return setError(`Term dates must be within the session (${formatDate(s.start_date)} to ${formatDate(s.end_date)}).`);
    if (form.next_term_begins && form.next_term_begins <= form.end_date) return setError("'Next term begins' must be after this term ends.");
    setBusy(true);
    setError(null);
    try {
      const values = { schoolId, name: form.name.trim(), startDate: form.start_date, endDate: form.end_date, nextTermBegins: form.next_term_begins || null };
      await (form.id ? api("terms.update", { ...values, id: form.id }) : api("terms.create", { ...values, sessionId: s.id, termNumber: form.term_number }));
      onSaved();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${form.id ? "Edit" : "Add"} ${form.name || "term"} - ${s.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Term name" htmlFor="t-name">
          <input id="t-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Resumes" htmlFor="t-start">
            <input id="t-start" type="date" className="input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </Field>
          <Field label="Vacates" htmlFor="t-end">
            <input id="t-end" type="date" className="input" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </Field>
        </div>
        <Field label="Next term begins" htmlFor="t-next" hint="Printed on report cards. Leave empty for the last term if not yet known.">
          <input id="t-next" type="date" className="input" value={form.next_term_begins} onChange={(e) => setForm({ ...form, next_term_begins: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Save term</Button>
        </div>
      </form>
    </Modal>
  );
}

export function CalendarPage() {
  const { activeSchool, currentTerm, refreshCalendar } = useAuth();
  const schoolId = activeSchool!.id;
  const { data: sessions, error, loading, reload } = useAsync(() => loadSessions(schoolId), [schoolId]);
  const [sessionModal, setSessionModal] = useState<SessionForm | null>(null);
  const [termModal, setTermModal] = useState<TermForm | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const saved = async (text: string) => {
    setSessionModal(null);
    setTermModal(null);
    setMessage({ tone: "success", text });
    await Promise.all([reload(), refreshCalendar()]);
  };

  async function makeCurrent(term: Term, session: AcademicSession) {
    setMessage(null);
    setBusyId(term.id);
    try {
      await api("calendar.setCurrentTerm", { schoolId, termId: term.id });
    } catch (err) {
      return setMessage({ tone: "error", text: friendlyError(err) });
    } finally {
      setBusyId(null);
    }
    await saved(`${term.name}, ${session.name} is now the current term across the app.`);
  }

  async function remove(kind: "term" | "session", id: string, label: string) {
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    setMessage(null);
    try {
      await api(kind === "term" ? "terms.delete" : "sessions.delete", { schoolId, id });
    } catch (err) {
      return setMessage({ tone: "error", text: friendlyError(err) });
    }
    await saved(`${label} deleted.`);
  }

  function newSession() {
    const latest = sessions?.[0];
    const year = latest ? Number(latest.name.slice(0, 4)) + 1 : new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    setSessionModal(suggestSession(year));
  }

  if (loading && !sessions) return <FullPageSpinner />;

  return (
    <>
      <PageHeader
        title="Sessions & terms"
        description="The school calendar. The current term decides what every screen, register and report card uses."
        actions={<Button onClick={newSession}><CalendarPlus className="h-4 w-4" aria-hidden /> New session</Button>}
      />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}
      {!currentTerm && sessions && sessions.length > 0 && (
        <div className="mb-4"><Alert tone="info">No current term is set. Click "Make current" on the term you are in now.</Alert></div>
      )}

      {sessions?.length === 0 && (
        <EmptyState title="No sessions yet">
          Create your first academic session (for example 2026/2027), then add its three terms.
          <div className="mt-4"><Button onClick={newSession}>Create first session</Button></div>
        </EmptyState>
      )}

      <div className="space-y-5">
        {sessions?.map((session) => {
          const missing = ([1, 2, 3] as const).filter((n) => !session.terms.some((t) => t.term_number === n));
          return (
            <section key={session.id} className="card overflow-hidden">
              <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <h2 className="flex items-center gap-2 font-semibold">
                    {session.name} {session.is_current && <Badge tone="green">Current session</Badge>}
                  </h2>
                  <p className="text-sm text-slate-500">{formatDate(session.start_date)} to {formatDate(session.end_date)}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setSessionModal({ id: session.id, name: session.name, start_date: session.start_date, end_date: session.end_date })}>
                    <Pencil className="h-4 w-4" aria-hidden /> Edit
                  </Button>
                  {session.terms.length === 0 && (
                    <Button variant="ghost" className="text-red-600" onClick={() => void remove("session", session.id, `session ${session.name}`)}>Delete</Button>
                  )}
                </div>
              </div>
              <ul className="divide-y divide-slate-100">
                {session.terms.map((term) => (
                  <li key={term.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                    <div className="flex-1">
                      <p className="flex items-center gap-2 font-medium">
                        {term.name} {term.is_current && <Badge tone="brand">Current term</Badge>}
                      </p>
                      <p className="text-sm text-slate-500">
                        {formatDate(term.start_date)} to {formatDate(term.end_date)}
                        {term.next_term_begins && <> · next term begins {formatDate(term.next_term_begins)}</>}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!term.is_current && (
                        <Button variant="secondary" loading={busyId === term.id} onClick={() => void makeCurrent(term, session)}>Make current</Button>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => setTermModal({ id: term.id, session, term_number: term.term_number, name: term.name, start_date: term.start_date, end_date: term.end_date, next_term_begins: term.next_term_begins ?? "" })}
                      >
                        <Pencil className="h-4 w-4" aria-hidden /> Edit
                      </Button>
                      {!term.is_current && (
                        <Button variant="ghost" className="text-red-600" onClick={() => void remove("term", term.id, `${term.name} ${session.name}`)}>Delete</Button>
                      )}
                    </div>
                  </li>
                ))}
                {missing.length > 0 && (
                  <li className="p-4">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const n = missing[0];
                        const s = suggestTerm(session, n);
                        setTermModal({ session, term_number: n, ...s, next_term_begins: s.next_term_begins ?? "" });
                      }}
                    >
                      <Plus className="h-4 w-4" aria-hidden /> Add {suggestTerm(session, missing[0]).name}
                    </Button>
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>

      {sessionModal && <SessionModal schoolId={schoolId} initial={sessionModal} onClose={() => setSessionModal(null)} onSaved={() => void saved("Session saved.")} />}
      {termModal && <TermModal schoolId={schoolId} initial={termModal} onClose={() => setTermModal(null)} onSaved={() => void saved("Term saved.")} />}
    </>
  );
}
