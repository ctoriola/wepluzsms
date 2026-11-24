import { sendPasswordResetEmail } from "firebase/auth";
import { ArrowUpRight, FileSpreadsheet, Plus, Search } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Badge, Button, EmptyState, Field, FullPageSpinner, Modal, PageHeader } from "@/components/ui";
import { loadLevels } from "@/lib/academics";
import { api, friendlyError } from "@/lib/api";
import { ageOn, fullName, loadAllStudents, loadStudentsInArms, NIGERIAN_STATES, RELATIONSHIPS, type Student } from "@/lib/students";
import { useAsync } from "@/lib/data";
import { auth } from "@/lib/firebase";
import { ADMIN_ROLES } from "@/lib/roles";
import { ArmSelect, armOptions, MedicalFlag, STATUS_TONE, StudentAvatar, type ArmOption } from "./common";

const SEES_ALL = ["proprietor", "principal", "school_admin", "bursar"] as const;

function AddStudentModal({ schoolId, arms, onClose }: { schoolId: string; arms: ArmOption[]; onClose: () => void }) {
  const navigate = useNavigate();
  const [f, setF] = useState({ firstName: "", middleName: "", lastName: "", gender: "", dateOfBirth: "", armId: "", admissionDate: new Date().toISOString().slice(0, 10), admissionNo: "", stateOfOrigin: "", gName: "", gPhone: "", gEmail: "", relationship: "Mother", login: true });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!f.armId) return setError("Choose the student's class.");
    if (!f.gender) return setError("Choose the student's gender.");
    if (f.gName && !f.gPhone && !f.gEmail) return setError("Give the guardian a phone number or an email.");
    setBusy(true);
    try {
      const out = await api<{ id: string; admissionNo: string }>("students.create", {
        schoolId,
        firstName: f.firstName,
        middleName: f.middleName || null,
        lastName: f.lastName,
        gender: f.gender,
        dateOfBirth: f.dateOfBirth || null,
        armId: f.armId,
        admissionDate: f.admissionDate,
        admissionNo: f.admissionNo || undefined,
        stateOfOrigin: f.stateOfOrigin || null,
      });
      if (f.gName.trim()) {
        const g = await api<{ sendPasswordEmailTo: string | null }>("guardians.add", {
          schoolId,
          studentId: out.id,
          relationship: f.relationship,
          guardian: { fullName: f.gName, phone: f.gPhone || null, email: f.gEmail || null },
          createLogin: f.login,
        }).catch((err) => {
          // The student exists; show the guardian problem on their profile page.
          sessionStorage.setItem("wepluz.notice", `Student added (${out.admissionNo}), but the guardian was not saved: ${friendlyError(err)}`);
          return null;
        });
        if (g?.sendPasswordEmailTo) await sendPasswordResetEmail(auth, g.sendPasswordEmailTo, { url: `${window.location.origin}/login` }).catch(() => undefined);
      }
      if (!sessionStorage.getItem("wepluz.notice")) sessionStorage.setItem("wepluz.notice", `Student added. Admission number ${out.admissionNo}.`);
      navigate(`/students/${out.id}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add a student" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="First name" htmlFor="s-first"><input id="s-first" className="input" value={f.firstName} onChange={set("firstName")} /></Field>
          <Field label="Middle name" htmlFor="s-mid"><input id="s-mid" className="input" value={f.middleName} onChange={set("middleName")} /></Field>
          <Field label="Surname" htmlFor="s-last"><input id="s-last" className="input" value={f.lastName} onChange={set("lastName")} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Gender" htmlFor="s-gender">
            <select id="s-gender" className="input" value={f.gender} onChange={set("gender")}>
              <option value="">Choose</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </Field>
          <Field label="Date of birth" htmlFor="s-dob"><input id="s-dob" type="date" className="input" value={f.dateOfBirth} onChange={set("dateOfBirth")} /></Field>
          <Field label="State of origin" htmlFor="s-state">
            <select id="s-state" className="input" value={f.stateOfOrigin} onChange={set("stateOfOrigin")}>
              <option value="">Select</option>
              {NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Class" htmlFor="s-arm"><ArmSelect id="s-arm" value={f.armId} onChange={(v) => setF({ ...f, armId: v })} arms={arms} /></Field>
          <Field label="Admission date" htmlFor="s-adate"><input id="s-adate" type="date" className="input" value={f.admissionDate} onChange={set("admissionDate")} /></Field>
          <Field label="Admission number" htmlFor="s-ano" hint="Leave blank to generate"><input id="s-ano" className="input uppercase" value={f.admissionNo} onChange={set("admissionNo")} /></Field>
        </div>
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">Parent or guardian (optional, can be added later)</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" htmlFor="g-name"><input id="g-name" className="input" value={f.gName} onChange={set("gName")} placeholder="e.g. Mrs Bisi Lawal" /></Field>
            <Field label="Relationship" htmlFor="g-rel">
              <select id="g-rel" className="input" value={f.relationship} onChange={set("relationship")}>
                {RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Phone" htmlFor="g-phone"><input id="g-phone" type="tel" className="input" value={f.gPhone} onChange={set("gPhone")} placeholder="0803 123 4567" /></Field>
            <Field label="Email" htmlFor="g-email"><input id="g-email" type="email" className="input" value={f.gEmail} onChange={set("gEmail")} /></Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.login} onChange={(e) => setF({ ...f, login: e.target.checked })} /> Give this parent a login to the parent app
          </label>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Add student</Button>
        </div>
      </form>
    </Modal>
  );
}

export function StudentsPage() {
  const { activeSchool, can, profile } = useAuth();
  const sid = activeSchool!.id;
  const seesAll = can([...SEES_ALL]);
  const isAdmin = can(ADMIN_ROLES);
  const [armFilter, setArmFilter] = useState("");
  const [status, setStatus] = useState<"active" | "withdrawn" | "graduated" | "all">("active");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);

  const data = useAsync(async () => {
    const levels = await loadLevels(sid);
    const arms = armOptions(levels);
    const visibleArms = seesAll ? arms : arms.filter((a) => a.teacherIds.includes(profile!.id));
    const students = seesAll ? await loadAllStudents(sid) : await loadStudentsInArms(sid, visibleArms.map((a) => a.id));
    return { arms, visibleArms, students };
  }, [sid, seesAll, profile?.id]);

  const armLabel = useMemo(() => new Map((data.data?.arms ?? []).map((a) => [a.id, a])), [data.data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data.data?.students ?? [])
      .filter((s) => (status === "all" ? true : s.status === status))
      .filter((s) => !armFilter || s.currentArmId === armFilter)
      .filter((s) => !needle || s.searchKey.includes(needle))
      .sort((a, b) => {
        const oa = armLabel.get(a.currentArmId ?? "")?.order ?? 9999;
        const ob = armLabel.get(b.currentArmId ?? "")?.order ?? 9999;
        return oa - ob || (armLabel.get(a.currentArmId ?? "")?.label ?? "").localeCompare(armLabel.get(b.currentArmId ?? "")?.label ?? "") || a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
      });
  }, [data.data, status, armFilter, q, armLabel]);

  if (data.loading && !data.data) return <FullPageSpinner />;
  const counts = (data.data?.students ?? []).reduce((m, s) => ({ ...m, [s.status]: (m[s.status] ?? 0) + 1 }), {} as Record<string, number>);

  return (
    <>
      <PageHeader
        title="Students"
        description={seesAll ? `${counts.active ?? 0} active students` : "Students in the classes you teach"}
        actions={
          isAdmin ? (
            <>
              <Link to="/students/promotion"><Button variant="secondary"><ArrowUpRight className="h-4 w-4" aria-hidden /> Promote</Button></Link>
              <Link to="/students/import"><Button variant="secondary"><FileSpreadsheet className="h-4 w-4" aria-hidden /> Import</Button></Link>
              <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden /> Student</Button>
            </>
          ) : undefined
        }
      />
      {data.error && <div className="mb-4"><Alert>{data.error}</Alert></div>}

      {!seesAll && data.data?.visibleArms.length === 0 ? (
        <EmptyState title="No classes yet">You will see students here once you are a form tutor or have a subject in a class.</EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative block lg:w-72">
              <span className="sr-only">Search students</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input className="input pl-9" placeholder="Search name or admission no." value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <div className="sm:w-56">
              <ArmSelect id="filter-arm" value={armFilter} onChange={setArmFilter} arms={data.data?.visibleArms ?? []} placeholder="All classes" />
            </div>
            {seesAll && (
              <div className="flex gap-1 rounded-lg bg-slate-100 p-1 lg:ml-auto">
                {(["active", "withdrawn", "graduated", "all"] as const).map((st) => (
                  <button key={st} onClick={() => setStatus(st)} aria-pressed={status === st} className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${status === st ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
                    {st}{st !== "all" && counts[st] ? ` (${counts[st]})` : ""}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card divide-y divide-slate-100">
            {rows.length === 0 && <p className="p-6 text-center text-sm text-slate-500">{data.data?.students.length ? "No students match." : "No students yet. Add one, or import your list from Excel."}</p>}
            {rows.map((s: Student) => (
              <Link key={s.id} to={`/students/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <StudentAvatar student={s} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{fullName(s)}</p>
                  <p className="truncate text-xs text-slate-500">
                    {s.admissionNo}
                    {s.dateOfBirth ? ` · ${ageOn(s.dateOfBirth)} yrs` : ""}
                  </p>
                </div>
                {s.hasMedicalAlert && <MedicalFlag compact />}
                <span className="hidden w-28 text-sm text-slate-600 sm:block">{armLabel.get(s.currentArmId ?? "")?.label ?? "No class"}</span>
                {s.status !== "active" && <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>}
              </Link>
            ))}
          </div>
          {rows.length > 0 && <p className="mt-2 text-right text-xs text-slate-500">{rows.length} shown</p>}
        </>
      )}
      {adding && data.data && <AddStudentModal schoolId={sid} arms={data.data.arms} onClose={() => setAdding(false)} />}
    </>
  );
}
