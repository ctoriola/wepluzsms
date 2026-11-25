import { Pencil, Plus } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Badge, Button, EmptyState, Field, FullPageSpinner, Modal, PageHeader } from "@/components/ui";
import {
  CATEGORY_LABELS,
  loadClassSubjects,
  loadLevels,
  loadSubjects,
  SECTION_LABELS,
  SECTIONS,
  SUBJECT_CATEGORIES,
  type ClassSubject,
  type Section,
  type SubjectCategory,
} from "@/lib/academics";
import { useAsync } from "@/lib/data";
import { api, friendlyError } from "@/lib/api";

type SubjectForm = { id?: string; name: string; short_code: string; category: SubjectCategory };
type Cell = "none" | "compulsory" | "elective";

function suggestCode(name: string) {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3);
  return words.map((w) => w[0]).join("").slice(0, 5);
}

export function SubjectsPage() {
  const { activeSchool } = useAuth();
  const schoolId = activeSchool!.id;
  const subjects = useAsync(() => loadSubjects(schoolId), [schoolId]);
  const levels = useAsync(() => loadLevels(schoolId), [schoolId]);
  const offerings = useAsync(() => loadClassSubjects(schoolId), [schoolId]);
  const [tab, setTab] = useState<"matrix" | "list">("matrix");
  const [section, setSection] = useState<Section | null>(null);
  const [modal, setModal] = useState<SubjectForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingCell, setSavingCell] = useState<string | null>(null);

  const sectionsPresent = SECTIONS.filter((s) => levels.data?.some((l) => l.section === s));
  const activeSection = section && sectionsPresent.includes(section) ? section : sectionsPresent[0] ?? null;
  const sectionLevels = (levels.data ?? []).filter((l) => l.section === activeSection);

  const offeringMap = useMemo(() => {
    const m = new Map<string, ClassSubject>();
    for (const o of offerings.data ?? []) m.set(`${o.class_level_id}:${o.subject_id}`, o);
    return m;
  }, [offerings.data]);

  const usedIn = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of offerings.data ?? []) m.set(o.subject_id, (m.get(o.subject_id) ?? 0) + 1);
    return m;
  }, [offerings.data]);

  // In the matrix, show subjects offered somewhere in this section first, then the rest.
  const matrixSubjects = useMemo(() => {
    const levelIds = new Set(sectionLevels.map((l) => l.id));
    const inSection = (sid: string) => (offerings.data ?? []).some((o) => o.subject_id === sid && levelIds.has(o.class_level_id));
    return [...(subjects.data ?? [])].sort((a, b) => Number(inSection(b.id)) - Number(inSection(a.id)) || a.name.localeCompare(b.name));
  }, [subjects.data, offerings.data, sectionLevels]);

  function cellState(levelId: string, subjectId: string): Cell {
    const o = offeringMap.get(`${levelId}:${subjectId}`);
    return !o ? "none" : o.is_compulsory ? "compulsory" : "elective";
  }

  async function cycle(levelId: string, subjectId: string) {
    const key = `${levelId}:${subjectId}`;
    const current = offeringMap.get(key);
    const next: Cell = !current ? "compulsory" : current.is_compulsory ? "elective" : "none";
    setMessage(null);
    setSavingCell(key);
    try {
      await api("levels.setSubject", { schoolId, levelId, subjectId, state: next });
    } catch (err) {
      setMessage({ tone: "error", text: friendlyError(err) });
    } finally {
      setSavingCell(null);
    }
    await offerings.reload();
  }

  async function saveSubject(e: FormEvent) {
    e.preventDefault();
    if (!modal) return;
    const name = modal.name.trim();
    const code = modal.short_code.trim().toUpperCase();
    if (name.length < 2) return setFormError("Enter the subject name.");
    if (!/^[A-Z0-9]{2,8}$/.test(code)) return setFormError("Code must be 2-8 letters or numbers, e.g. MTH.");
    setBusy(true);
    try {
      const values = { schoolId, name, shortCode: code, category: modal.category };
      await (modal.id ? api("subjects.update", { ...values, id: modal.id }) : api("subjects.create", values));
    } catch (err) {
      return setFormError(friendlyError(err));
    } finally {
      setBusy(false);
    }
    setModal(null);
    setMessage({ tone: "success", text: `${name} saved.${modal.id ? "" : " Tick the classes that offer it in the 'Subjects by class' tab."}` });
    await subjects.reload();
  }

  async function deleteSubject(id: string, name: string) {
    if (!window.confirm(`Delete ${name}?`)) return;
    try {
      await api("subjects.delete", { schoolId, id });
    } catch (err) {
      return setFormError(friendlyError(err));
    }
    setModal(null);
    setMessage({ tone: "success", text: `${name} deleted.` });
    await subjects.reload();
  }

  if ((subjects.loading && !subjects.data) || (levels.loading && !levels.data)) return <FullPageSpinner />;
  const error = subjects.error ?? levels.error ?? offerings.error;

  const tabBtn = (t: "matrix" | "list", label: string) => (
    <button role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
      {label}
    </button>
  );

  return (
    <>
      <PageHeader
        title="Subjects"
        description="Your subject list and which classes offer each subject."
        actions={<Button onClick={() => { setFormError(null); setModal({ name: "", short_code: "", category: "core" }); }}><Plus className="h-4 w-4" aria-hidden /> Subject</Button>}
      />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}

      <div className="mb-4 flex gap-1 self-start rounded-lg bg-slate-100 p-1" role="tablist">
        {tabBtn("matrix", "Subjects by class")}
        {tabBtn("list", `All subjects (${subjects.data?.length ?? 0})`)}
      </div>

      {tab === "matrix" && (
        <>
          {sectionsPresent.length === 0 ? (
            <EmptyState title="No classes yet">Create your classes first under Classes & arms (the starter template also adds subjects).</EmptyState>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {sectionsPresent.map((s) => (
                  <button key={s} onClick={() => setSection(s)} className={`rounded-full border px-3 py-1 text-sm ${activeSection === s ? "border-brand bg-brand text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
                    {SECTION_LABELS[s]}
                  </button>
                ))}
                <span className="ml-auto flex items-center gap-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-brand" /> Compulsory</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border-2 border-brand bg-white" /> Elective</span>
                  <span>Click a box to change</span>
                </span>
              </div>
              <div className="card overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th scope="col" className="sticky left-0 bg-slate-50 px-3 py-2 text-left font-semibold">Subject</th>
                      {sectionLevels.map((l) => <th key={l.id} scope="col" className="px-2 py-2 text-center font-semibold whitespace-nowrap">{l.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {matrixSubjects.map((s) => (
                      <tr key={s.id} className="border-b border-slate-100 last:border-0">
                        <th scope="row" className="sticky left-0 bg-white px-3 py-1.5 text-left font-medium">{s.name}</th>
                        {sectionLevels.map((l) => {
                          const state = cellState(l.id, s.id);
                          const key = `${l.id}:${s.id}`;
                          return (
                            <td key={l.id} className="px-2 py-1.5 text-center">
                              <button
                                onClick={() => void cycle(l.id, s.id)}
                                disabled={savingCell === key}
                                aria-label={`${s.name} in ${l.name}: ${state === "none" ? "not offered" : state}`}
                                className={`h-6 w-6 rounded transition disabled:opacity-40 ${state === "compulsory" ? "bg-brand" : state === "elective" ? "border-2 border-brand bg-white" : "border border-slate-300 bg-white hover:border-brand/60"}`}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {tab === "list" && (
        <div className="card divide-y divide-slate-100">
          {subjects.data?.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No subjects yet.</p>}
          {subjects.data?.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-14 shrink-0 font-mono text-xs text-slate-500">{s.short_code}</span>
              <span className="flex-1 font-medium">{s.name}</span>
              <Badge>{CATEGORY_LABELS[s.category]}</Badge>
              <span className="hidden w-28 text-right text-xs text-slate-500 sm:block">{usedIn.get(s.id) ?? 0} classes</span>
              <button className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label={`Edit ${s.name}`} onClick={() => { setFormError(null); setModal({ ...s }); }}>
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <Modal title={modal.id ? `Edit ${modal.name}` : "Add subject"} onClose={() => setModal(null)}>
          <form onSubmit={saveSubject} className="space-y-4">
            {formError && <Alert>{formError}</Alert>}
            <Field label="Subject name" htmlFor="sub-name">
              <input
                id="sub-name"
                className="input"
                value={modal.name}
                onChange={(e) => setModal({ ...modal, name: e.target.value, short_code: modal.id || modal.short_code !== suggestCode(modal.name) ? modal.short_code : suggestCode(e.target.value) })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Short code" htmlFor="sub-code" hint="Used on broadsheets">
                <input id="sub-code" className="input uppercase" value={modal.short_code} onChange={(e) => setModal({ ...modal, short_code: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="Category" htmlFor="sub-cat">
                <select id="sub-cat" className="input" value={modal.category} onChange={(e) => setModal({ ...modal, category: e.target.value as SubjectCategory })}>
                  {SUBJECT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex justify-between gap-2">
              {modal.id ? <Button type="button" variant="ghost" className="text-red-600" onClick={() => void deleteSubject(modal.id!, modal.name)}>Delete</Button> : <span />}
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
                <Button type="submit" loading={busy}>Save</Button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
