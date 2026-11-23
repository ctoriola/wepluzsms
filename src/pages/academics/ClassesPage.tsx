import { ArrowDown, ArrowUp, Pencil, Plus, Sparkles } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Button, EmptyState, Field, FullPageSpinner, Modal, PageHeader } from "@/components/ui";
import { loadLevels, loadTeachingStaff, SECTION_LABELS, SECTIONS, type ClassArm, type ClassLevel, type Section } from "@/lib/academics";
import { useAsync } from "@/lib/data";
import { friendlyError, supabase } from "@/lib/supabase";

type LevelForm = { id?: string; name: string; section: Section };
type ArmForm = { id?: string; level: ClassLevel; name: string; form_tutor_id: string; capacity: string };

function TemplateModal({ schoolId, existing, onClose, onDone }: { schoolId: string; existing: Set<Section>; onClose: () => void; onDone: (msg: string) => void }) {
  const [picked, setPicked] = useState<Section[]>(SECTIONS.filter((s) => !existing.has(s) && s !== "nursery"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    if (picked.length === 0) return setError("Choose at least one section.");
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("apply_nigerian_template", { p_school_id: schoolId, p_sections: picked });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    const r = data as { levels_added: number; subjects_added: number; offerings_added: number };
    onDone(`Added ${r.levels_added} classes and ${r.subjects_added} subjects. Add arms to each class, then review the subjects to match your curriculum.`);
  }

  return (
    <Modal title="Nigerian starter template" onClose={onClose}>
      <p className="mb-4 text-sm text-slate-600">
        Creates the usual class levels and a common subject list for each section you pick. Anything you already have is kept. You can rename or remove anything afterwards.
      </p>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      <fieldset className="space-y-2">
        <legend className="label">Sections your school runs</legend>
        {SECTIONS.map((s) => (
          <label key={s} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm">
            <input type="checkbox" checked={picked.includes(s)} onChange={(e) => setPicked(e.target.checked ? [...picked, s] : picked.filter((x) => x !== s))} />
            <span className="flex-1 font-medium">{SECTION_LABELS[s]}</span>
            <span className="text-xs text-slate-500">
              {{ nursery: "Creche - Nursery 2", primary: "Primary 1-6", junior_secondary: "JSS 1-3", senior_secondary: "SS 1-3" }[s]}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={busy} onClick={() => void apply()}>Apply template</Button>
      </div>
    </Modal>
  );
}

export function ClassesPage() {
  const { activeSchool } = useAuth();
  const schoolId = activeSchool!.id;
  const levels = useAsync(() => loadLevels(schoolId), [schoolId]);
  const staff = useAsync(() => loadTeachingStaff(schoolId), [schoolId]);
  const [levelModal, setLevelModal] = useState<LevelForm | null>(null);
  const [armModal, setArmModal] = useState<ArmForm | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const staffName = useMemo(() => new Map((staff.data ?? []).map((s) => [s.id, s.name])), [staff.data]);
  const bySection = useMemo(() => {
    const map = new Map<Section, ClassLevel[]>();
    for (const l of levels.data ?? []) map.set(l.section, [...(map.get(l.section) ?? []), l]);
    return map;
  }, [levels.data]);

  const done = async (text: string) => {
    setLevelModal(null);
    setArmModal(null);
    setTemplateOpen(false);
    setFormError(null);
    setMessage({ tone: "success", text });
    await levels.reload();
  };

  async function saveLevel(e: FormEvent) {
    e.preventDefault();
    if (!levelModal) return;
    const name = levelModal.name.trim();
    if (!name) return setFormError("Enter the class name, e.g. JSS 1.");
    setBusy(true);
    let res;
    if (levelModal.id) {
      res = await supabase.from("class_levels").update({ name, section: levelModal.section }).eq("id", levelModal.id);
    } else {
      const maxOrder = Math.max(0, ...(levels.data ?? []).filter((l) => l.section === levelModal.section).map((l) => l.order_index));
      const base = { nursery: 0, primary: 100, junior_secondary: 200, senior_secondary: 300 }[levelModal.section];
      res = await supabase.from("class_levels").insert({ school_id: schoolId, name, section: levelModal.section, order_index: Math.max(maxOrder, base) + 1 });
    }
    setBusy(false);
    if (res.error) return setFormError(res.error.code === "23505" ? "A class with that name already exists." : friendlyError(res.error));
    await done(`Class ${name} saved.`);
  }

  async function saveArm(e: FormEvent) {
    e.preventDefault();
    if (!armModal) return;
    const name = armModal.name.trim();
    if (!name) return setFormError("Enter the arm name, e.g. A or Gold.");
    const capacity = armModal.capacity.trim() ? Number(armModal.capacity) : null;
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 200)) return setFormError("Capacity must be a whole number between 1 and 200.");
    setBusy(true);
    const values = { name, form_tutor_id: armModal.form_tutor_id || null, capacity };
    const res = armModal.id
      ? await supabase.from("class_arms").update(values).eq("id", armModal.id)
      : await supabase.from("class_arms").insert({ ...values, school_id: schoolId, class_level_id: armModal.level.id });
    setBusy(false);
    if (res.error) return setFormError(res.error.code === "23505" ? "This class already has an arm with that name." : friendlyError(res.error));
    await done(`${armModal.level.name} ${name} saved.`);
  }

  async function move(level: ClassLevel, dir: -1 | 1) {
    const siblings = bySection.get(level.section) ?? [];
    const i = siblings.findIndex((l) => l.id === level.id);
    const other = siblings[i + dir];
    if (!other) return;
    setMessage(null);
    // Swap order positions (give distinct values if they were equal).
    const a = level.order_index === other.order_index ? other.order_index + dir : other.order_index;
    const r1 = await supabase.from("class_levels").update({ order_index: a }).eq("id", level.id);
    const r2 = await supabase.from("class_levels").update({ order_index: level.order_index }).eq("id", other.id);
    if (r1.error || r2.error) setMessage({ tone: "error", text: friendlyError(r1.error ?? r2.error) });
    await levels.reload();
  }

  async function remove(kind: "level" | "arm", id: string, label: string) {
    if (!window.confirm(`Delete ${label}?`)) return;
    setMessage(null);
    if (kind === "level") {
      // A class with no arms has no teachers, so its subject list can go with it.
      const cleared = await supabase.from("class_subjects").delete().eq("class_level_id", id);
      if (cleared.error) return setMessage({ tone: "error", text: friendlyError(cleared.error) });
    }
    const { error } = await supabase.from(kind === "level" ? "class_levels" : "class_arms").delete().eq("id", id);
    if (error) {
      const inUse = error.code === "23503";
      return setMessage({ tone: "error", text: inUse ? `${label} is in use (it has ${kind === "level" ? "arms or subjects" : "teachers assigned"}). Remove those first.` : friendlyError(error) });
    }
    await done(`${label} deleted.`);
  }

  if (levels.loading && !levels.data) return <FullPageSpinner />;
  const existingSections = new Set((levels.data ?? []).map((l) => l.section));

  return (
    <>
      <PageHeader
        title="Classes & arms"
        description="Class levels (e.g. JSS 1) and their arms (e.g. JSS 1 A), with form tutors."
        actions={
          <>
            <Button variant="secondary" onClick={() => setTemplateOpen(true)}><Sparkles className="h-4 w-4" aria-hidden /> Template</Button>
            <Button onClick={() => { setFormError(null); setLevelModal({ name: "", section: "junior_secondary" }); }}><Plus className="h-4 w-4" aria-hidden /> Class</Button>
          </>
        }
      />
      {levels.error && <div className="mb-4"><Alert>{levels.error}</Alert></div>}
      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}

      {levels.data?.length === 0 && (
        <EmptyState title="Set up your classes in one click">
          Use the Nigerian starter template to create Primary 1-6, JSS 1-3 and SS 1-3 with common subjects, or add classes one by one.
          <div className="mt-4"><Button onClick={() => setTemplateOpen(true)}><Sparkles className="h-4 w-4" aria-hidden /> Use template</Button></div>
        </EmptyState>
      )}

      <div className="space-y-6">
        {SECTIONS.filter((s) => bySection.has(s)).map((section) => (
          <section key={section}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{SECTION_LABELS[section]}</h2>
            <div className="card divide-y divide-slate-100">
              {bySection.get(section)!.map((level, i, arr) => (
                <div key={level.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start">
                  <div className="flex items-center gap-2 lg:w-48">
                    <div className="flex flex-col">
                      <button className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" disabled={i === 0} onClick={() => void move(level, -1)} aria-label={`Move ${level.name} up`}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" disabled={i === arr.length - 1} onClick={() => void move(level, 1)} aria-label={`Move ${level.name} down`}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="flex-1 font-semibold">{level.name}</p>
                    <button className="rounded p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => { setFormError(null); setLevelModal({ id: level.id, name: level.name, section: level.section }); }} aria-label={`Edit ${level.name}`}>
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex flex-1 flex-wrap gap-2">
                    {level.class_arms.map((arm: ClassArm) => (
                      <button
                        key={arm.id}
                        onClick={() => { setFormError(null); setArmModal({ id: arm.id, level, name: arm.name, form_tutor_id: arm.form_tutor_id ?? "", capacity: arm.capacity?.toString() ?? "" }); }}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-brand/40 hover:bg-brand/5"
                      >
                        <span className="font-medium">{level.name} {arm.name}</span>
                        <span className="block text-xs text-slate-500">
                          {arm.form_tutor_id ? `Tutor: ${staffName.get(arm.form_tutor_id) ?? "..."}` : "No form tutor"}
                          {arm.capacity ? ` · max ${arm.capacity}` : ""}
                        </span>
                      </button>
                    ))}
                    <button
                      onClick={() => { setFormError(null); setArmModal({ level, name: String.fromCharCode(65 + level.class_arms.length), form_tutor_id: "", capacity: "30" }); }}
                      className="flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-brand hover:text-brand"
                    >
                      <Plus className="h-4 w-4" aria-hidden /> Arm
                    </button>
                  </div>
                  {level.class_arms.length === 0 && (
                    <Button variant="ghost" className="self-start text-red-600" onClick={() => void remove("level", level.id, level.name)}>Delete</Button>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {templateOpen && <TemplateModal schoolId={schoolId} existing={existingSections} onClose={() => setTemplateOpen(false)} onDone={(t) => void done(t)} />}

      {levelModal && (
        <Modal title={levelModal.id ? "Edit class" : "Add class"} onClose={() => setLevelModal(null)}>
          <form onSubmit={saveLevel} className="space-y-4">
            {formError && <Alert>{formError}</Alert>}
            <Field label="Class name" htmlFor="l-name" hint="For example JSS 1, Primary 4 or Year 7">
              <input id="l-name" className="input" value={levelModal.name} onChange={(e) => setLevelModal({ ...levelModal, name: e.target.value })} />
            </Field>
            <Field label="Section" htmlFor="l-section">
              <select id="l-section" className="input" value={levelModal.section} onChange={(e) => setLevelModal({ ...levelModal, section: e.target.value as Section })}>
                {SECTIONS.map((s) => <option key={s} value={s}>{SECTION_LABELS[s]}</option>)}
              </select>
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setLevelModal(null)}>Cancel</Button>
              <Button type="submit" loading={busy}>Save</Button>
            </div>
          </form>
        </Modal>
      )}

      {armModal && (
        <Modal title={armModal.id ? `Edit ${armModal.level.name} ${armModal.name}` : `Add arm to ${armModal.level.name}`} onClose={() => setArmModal(null)}>
          <form onSubmit={saveArm} className="space-y-4">
            {formError && <Alert>{formError}</Alert>}
            <Field label="Arm name" htmlFor="a-name" hint="For example A, B, Gold or Science">
              <input id="a-name" className="input" value={armModal.name} onChange={(e) => setArmModal({ ...armModal, name: e.target.value })} />
            </Field>
            <Field label="Form tutor" htmlFor="a-tutor" hint={staff.data?.length ? undefined : "Invite teachers under Staff & access first."}>
              <select id="a-tutor" className="input" value={armModal.form_tutor_id} onChange={(e) => setArmModal({ ...armModal, form_tutor_id: e.target.value })}>
                <option value="">No form tutor yet</option>
                {staff.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Maximum students" htmlFor="a-cap">
              <input id="a-cap" type="number" min={1} max={200} className="input" value={armModal.capacity} onChange={(e) => setArmModal({ ...armModal, capacity: e.target.value })} />
            </Field>
            <div className="flex justify-between gap-2">
              {armModal.id ? (
                <Button type="button" variant="ghost" className="text-red-600" onClick={() => void remove("arm", armModal.id!, `${armModal.level.name} ${armModal.name}`)}>Delete arm</Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setArmModal(null)}>Cancel</Button>
                <Button type="submit" loading={busy}>Save</Button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
