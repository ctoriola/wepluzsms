import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Badge, EmptyState, FullPageSpinner, PageHeader } from "@/components/ui";
import { loadAssignments, loadClassSubjects, loadLevels, loadSubjects, loadTeachingStaff, SECTION_LABELS, SECTIONS, type TeacherAssignment } from "@/lib/academics";
import { api, friendlyError } from "@/lib/api";
import { useAsync } from "@/lib/data";

export function TeacherAssignmentsPage() {
  const { activeSchool, currentTerm } = useAuth();
  const schoolId = activeSchool!.id;
  const sessionId = currentTerm?.session_id ?? null;

  const levels = useAsync(() => loadLevels(schoolId), [schoolId]);
  const subjects = useAsync(() => loadSubjects(schoolId), [schoolId]);
  const offerings = useAsync(() => loadClassSubjects(schoolId), [schoolId]);
  const staff = useAsync(() => loadTeachingStaff(schoolId), [schoolId]);
  const assignments = useAsync(async () => (sessionId ? loadAssignments(schoolId, sessionId) : []), [schoolId, sessionId]);

  const [armId, setArmId] = useState<string>("");
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const arms = useMemo(() => (levels.data ?? []).flatMap((l) => l.class_arms.map((a) => ({ ...a, level: l }))), [levels.data]);
  const selected = arms.find((a) => a.id === armId) ?? arms[0];
  const subjectById = useMemo(() => new Map((subjects.data ?? []).map((s) => [s.id, s])), [subjects.data]);
  const staffById = useMemo(() => new Map((staff.data ?? []).map((s) => [s.id, s.name])), [staff.data]);
  const armLabel = useMemo(() => new Map(arms.map((a) => [a.id, `${a.level.name} ${a.name}`])), [arms]);

  const rows = useMemo(() => {
    if (!selected) return [];
    return (offerings.data ?? [])
      .filter((o) => o.class_level_id === selected.class_level_id)
      .map((o) => ({ offering: o, subject: subjectById.get(o.subject_id)!, assignment: assignments.data?.find((a) => a.class_arm_id === selected.id && a.subject_id === o.subject_id) }))
      .filter((r) => r.subject)
      .sort((a, b) => Number(b.offering.is_compulsory) - Number(a.offering.is_compulsory) || a.subject.name.localeCompare(b.subject.name));
  }, [selected, offerings.data, subjectById, assignments.data]);

  const load = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of assignments.data ?? []) {
      const label = `${subjectById.get(a.subject_id)?.short_code ?? "?"} ${armLabel.get(a.class_arm_id) ?? ""}`;
      m.set(a.teacher_id, [...(m.get(a.teacher_id) ?? []), label]);
    }
    return [...m.entries()].map(([id, items]) => ({ id, name: staffById.get(id) ?? "Unknown", items: items.sort() })).sort((a, b) => b.items.length - a.items.length);
  }, [assignments.data, subjectById, armLabel, staffById]);

  async function assign(subjectId: string, teacherId: string, existing?: TeacherAssignment) {
    if (!selected || !sessionId || (!teacherId && !existing)) return;
    setMessage(null);
    setSaving(subjectId);
    try {
      await api("assignments.set", { schoolId, armId: selected.id, subjectId, teacherId: teacherId || null });
    } catch (err) {
      setMessage({ tone: "error", text: friendlyError(err) });
    } finally {
      setSaving(null);
    }
    await assignments.reload();
  }

  if (!currentTerm) {
    return (
      <>
        <PageHeader title="Teacher assignments" />
        <EmptyState title="Set the current term first">
          Assignments are made per session. <Link to="/academics/calendar" className="font-medium text-brand hover:underline">Set up sessions & terms</Link> and mark the current term.
        </EmptyState>
      </>
    );
  }
  if ((levels.loading && !levels.data) || (assignments.loading && !assignments.data)) return <FullPageSpinner />;
  const error = levels.error ?? subjects.error ?? offerings.error ?? staff.error ?? assignments.error;

  if (arms.length === 0) {
    return (
      <>
        <PageHeader title="Teacher assignments" />
        <EmptyState title="No class arms yet">
          <Link to="/academics/classes" className="font-medium text-brand hover:underline">Create classes and arms</Link> first.
        </EmptyState>
      </>
    );
  }

  const assignedCount = rows.filter((r) => r.assignment).length;

  return (
    <>
      <PageHeader title="Teacher assignments" description={`Who teaches each subject in each class for ${currentTerm.session_name}.`} />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
            <label htmlFor="arm" className="text-sm font-medium text-slate-700">Class</label>
            <select id="arm" className="input sm:w-56" value={selected?.id ?? ""} onChange={(e) => setArmId(e.target.value)}>
              {SECTIONS.filter((s) => levels.data?.some((l) => l.section === s)).map((s) => (
                <optgroup key={s} label={SECTION_LABELS[s]}>
                  {arms.filter((a) => a.level.section === s).map((a) => <option key={a.id} value={a.id}>{a.level.name} {a.name}</option>)}
                </optgroup>
              ))}
            </select>
            <div className="text-sm text-slate-500 sm:ml-auto">
              {selected?.form_tutor_id ? <>Form tutor: <span className="font-medium text-slate-700">{staffById.get(selected.form_tutor_id)}</span> · </> : null}
              {assignedCount}/{rows.length} assigned
            </div>
          </div>
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">
              No subjects offered in {selected?.level.name}. <Link to="/academics/subjects" className="font-medium text-brand hover:underline">Choose subjects</Link>.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map(({ offering, subject, assignment }) => (
                <li key={offering.id} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center">
                  <div className="flex flex-1 items-center gap-2">
                    <span className="font-medium">{subject.name}</span>
                    {!offering.is_compulsory && <Badge>Elective</Badge>}
                  </div>
                  <select
                    aria-label={`Teacher for ${subject.name}`}
                    className={`input sm:w-60 ${assignment ? "" : "text-slate-400"}`}
                    value={assignment?.teacher_id ?? ""}
                    disabled={saving === subject.id}
                    onChange={(e) => void assign(subject.id, e.target.value, assignment)}
                  >
                    <option value="">Not assigned</option>
                    {staff.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card self-start p-4">
          <h2 className="font-semibold">Teaching load</h2>
          <p className="mb-3 text-xs text-slate-500">Subject-class pairs per teacher this session.</p>
          {load.length === 0 && <p className="text-sm text-slate-500">No assignments yet.</p>}
          <ul className="space-y-3">
            {load.map((t) => (
              <li key={t.id}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{t.name}</span>
                  <Badge tone="brand">{t.items.length}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{t.items.join(", ")}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
