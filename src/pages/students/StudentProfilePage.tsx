import { sendPasswordResetEmail } from "firebase/auth";
import { ArrowLeft, Camera, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Badge, Button, EmptyState, Field, FullPageSpinner, Modal } from "@/components/ui";
import { loadLevels, loadSessions } from "@/lib/academics";
import { api, friendlyError } from "@/lib/api";
import { formatDate, useAsync } from "@/lib/data";
import { auth } from "@/lib/firebase";
import { resizeImageToDataUrl } from "@/lib/image";
import { formatPhone } from "@/lib/phone";
import { ADMIN_ROLES } from "@/lib/roles";
import {
  ageOn,
  fullName,
  loadAllGuardians,
  loadEnrolments,
  loadGuardians,
  loadMedical,
  loadPhoto,
  loadStudent,
  NIGERIAN_STATES,
  RELATIONSHIPS,
  type Guardian,
  type GuardianLink,
  type Medical,
  type Student,
} from "@/lib/students";
import { ArmSelect, armOptions, MedicalFlag, STATUS_TONE, StudentAvatar, type ArmOption } from "./common";

type Tab = "details" | "attendance" | "guardians" | "medical" | "history";

type Summary = { term: string; daysOpen: number; marked: number; present: number; late: number; absent: number; excused: number; rate: number | null; records: { date: string; status: string }[] };

function AttendanceTab({ sid, studentId }: { sid: string; studentId: string }) {
  const data = useAsync(() => api<Summary>("attendance.studentSummary", { schoolId: sid, studentId }), [sid, studentId]);
  if (data.loading) return <p className="text-sm text-slate-500">Loading attendance...</p>;
  if (data.error) return <Alert>{data.error}</Alert>;
  const s = data.data!;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Attendance", s.rate === null ? "-" : `${s.rate}%`], ["Present", s.present], ["Absent", s.absent], ["Late", s.late]].map(([k, v]) => (
          <div key={k as string} className="rounded-lg border border-slate-200 p-3"><p className="text-xl font-bold">{v}</p><p className="text-xs text-slate-500">{k}</p></div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">{s.term}: {s.marked} of {s.daysOpen} school days so far have a register.{s.excused ? ` ${s.excused} excused.` : ""}</p>
      <h3 className="mt-4 text-sm font-semibold">Absences and late arrivals</h3>
      {s.records.length === 0 ? <p className="mt-1 text-sm text-slate-500">None this term.</p> : (
        <ul className="mt-1 divide-y divide-slate-100 text-sm">
          {s.records.map((r) => (
            <li key={r.date} className="flex justify-between py-1.5">
              <span>{formatDate(r.date, { weekday: "short", day: "numeric", month: "short" })}</span>
              <Badge tone={r.status === "absent" ? "red" : r.status === "late" ? "amber" : "slate"}>{r.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
type Msg = { tone: "success" | "error"; text: string } | null;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="col-span-2 text-slate-900">{children || <span className="text-slate-400">Not recorded</span>}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ modals
function EditStudentModal({ sid, s, onClose, onDone }: { sid: string; s: Student; onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({
    firstName: s.firstName, middleName: s.middleName ?? "", lastName: s.lastName, gender: s.gender, dateOfBirth: s.dateOfBirth ?? "",
    admissionNo: s.admissionNo, admissionDate: s.admissionDate, stateOfOrigin: s.stateOfOrigin ?? "", lga: s.lga ?? "", religion: s.religion ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("students.update", { schoolId: sid, id: s.id, ...f, middleName: f.middleName || null, dateOfBirth: f.dateOfBirth || null, stateOfOrigin: f.stateOfOrigin || null, lga: f.lga || null, religion: f.religion || null });
      onDone("Details saved.");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Edit details" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="First name" htmlFor="e-first"><input id="e-first" className="input" value={f.firstName} onChange={set("firstName")} /></Field>
          <Field label="Middle name" htmlFor="e-mid"><input id="e-mid" className="input" value={f.middleName} onChange={set("middleName")} /></Field>
          <Field label="Surname" htmlFor="e-last"><input id="e-last" className="input" value={f.lastName} onChange={set("lastName")} /></Field>
          <Field label="Gender" htmlFor="e-gender">
            <select id="e-gender" className="input" value={f.gender} onChange={set("gender")}><option value="female">Female</option><option value="male">Male</option></select>
          </Field>
          <Field label="Date of birth" htmlFor="e-dob"><input id="e-dob" type="date" className="input" value={f.dateOfBirth} onChange={set("dateOfBirth")} /></Field>
          <Field label="Religion" htmlFor="e-rel"><input id="e-rel" className="input" value={f.religion} onChange={set("religion")} /></Field>
          <Field label="State of origin" htmlFor="e-state">
            <select id="e-state" className="input" value={f.stateOfOrigin} onChange={set("stateOfOrigin")}><option value="">Select</option>{NIGERIAN_STATES.map((x) => <option key={x}>{x}</option>)}</select>
          </Field>
          <Field label="LGA" htmlFor="e-lga"><input id="e-lga" className="input" value={f.lga} onChange={set("lga")} /></Field>
          <div />
          <Field label="Admission number" htmlFor="e-ano"><input id="e-ano" className="input uppercase" value={f.admissionNo} onChange={set("admissionNo")} /></Field>
          <Field label="Admission date" htmlFor="e-adate"><input id="e-adate" type="date" className="input" value={f.admissionDate} onChange={set("admissionDate")} /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function ClassModal({ sid, s, arms, mode, onClose, onDone }: { sid: string; s: Student; arms: ArmOption[]; mode: "change" | "reinstate"; onClose: () => void; onDone: (m: string) => void }) {
  const [armId, setArmId] = useState(mode === "change" ? s.currentArmId ?? "" : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!armId) return setError("Choose a class.");
    setBusy(true);
    try {
      await api(mode === "change" ? "students.changeArm" : "students.reinstate", { schoolId: sid, studentId: s.id, armId });
      onDone(mode === "change" ? `Moved to ${arms.find((a) => a.id === armId)?.label}.` : "Student reinstated.");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={mode === "change" ? "Change class" : "Reinstate student"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Class for this session" htmlFor="c-arm"><ArmSelect id="c-arm" value={armId} onChange={setArmId} arms={arms} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{mode === "change" ? "Move" : "Reinstate"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function WithdrawModal({ sid, s, onClose, onDone }: { sid: string; s: Student; onClose: () => void; onDone: (m: string) => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("students.withdraw", { schoolId: sid, studentId: s.id, date, reason });
      onDone(`${s.firstName} has been withdrawn.`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Withdraw ${s.firstName}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <p className="text-sm text-slate-600">The student leaves their class and registers. Their records are kept, and you can reinstate them later.</p>
        <Field label="Last day" htmlFor="w-date"><input id="w-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Reason" htmlFor="w-reason"><textarea id="w-reason" className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Family relocated to Abuja" /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" loading={busy}>Withdraw</Button>
        </div>
      </form>
    </Modal>
  );
}

function GuardianModal({ sid, s, editing, onClose, onDone }: { sid: string; s: Student; editing: { guardian: Guardian; link: GuardianLink } | null; onClose: () => void; onDone: (m: string) => void }) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [g, setG] = useState({ fullName: editing?.guardian.fullName ?? "", phone: formatPhone(editing?.guardian.phone) ?? "", email: editing?.guardian.email ?? "", whatsappPhone: formatPhone(editing?.guardian.whatsappPhone) ?? "", address: editing?.guardian.address ?? "", occupation: editing?.guardian.occupation ?? "" });
  const [link, setLink] = useState({ relationship: editing?.link.relationship ?? "Mother", isPrimary: editing?.link.isPrimary ?? s.guardians.length === 0, canPickup: editing?.link.canPickup ?? true, receivesBilling: editing?.link.receivesBilling ?? true });
  const [createLogin, setCreateLogin] = useState(true);
  const [existingId, setExistingId] = useState("");
  const [search, setSearch] = useState("");
  const all = useAsync(() => (editing ? Promise.resolve([]) : loadAllGuardians(sid)), [sid, editing]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setGF = (k: keyof typeof g) => (e: { target: { value: string } }) => setG({ ...g, [k]: e.target.value });

  const matches = useMemo(() => {
    const n = search.trim().toLowerCase();
    if (!n) return [];
    return (all.data ?? []).filter((x) => !s.guardians.some((l) => l.guardianId === x.id) && [x.fullName, x.phone, formatPhone(x.phone)].some((v) => v?.toLowerCase().includes(n))).slice(0, 8);
  }, [all.data, search, s.guardians]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api("guardians.update", { schoolId: sid, guardianId: editing.guardian.id, ...g, email: g.email || null, phone: g.phone || null, whatsappPhone: g.whatsappPhone || null, address: g.address || null, occupation: g.occupation || null });
        await api("guardians.setLink", { schoolId: sid, studentId: s.id, guardianId: editing.guardian.id, ...link });
        onDone("Guardian updated.");
      } else {
        if (mode === "existing" && !existingId) throw new Error("Search for and choose the guardian.");
        const out = await api<{ reused: boolean; sendPasswordEmailTo: string | null }>("guardians.add", {
          schoolId: sid,
          studentId: s.id,
          ...link,
          ...(mode === "existing" ? { guardianId: existingId } : { guardian: { fullName: g.fullName, phone: g.phone || null, email: g.email || null, address: g.address || null, occupation: g.occupation || null } }),
          createLogin,
        });
        if (out.sendPasswordEmailTo) await sendPasswordResetEmail(auth, out.sendPasswordEmailTo, { url: `${window.location.origin}/login` }).catch(() => undefined);
        onDone(mode === "existing" ? "Guardian linked." : out.reused ? "This guardian was already on file (same phone number), so they were linked." : "Guardian added.");
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const flags = (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Relationship" htmlFor="gl-rel">
        <select id="gl-rel" className="input" value={link.relationship} onChange={(e) => setLink({ ...link, relationship: e.target.value as typeof link.relationship })}>
          {RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}
        </select>
      </Field>
      <div className="space-y-1.5 pt-6 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={link.isPrimary} onChange={(e) => setLink({ ...link, isPrimary: e.target.checked })} /> Main contact</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={link.canPickup} onChange={(e) => setLink({ ...link, canPickup: e.target.checked })} /> Can pick up the child</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={link.receivesBilling} onChange={(e) => setLink({ ...link, receivesBilling: e.target.checked })} /> Receives fee invoices</label>
      </div>
    </div>
  );

  return (
    <Modal title={editing ? `Edit ${editing.guardian.fullName}` : `Add a guardian for ${s.firstName}`} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {!editing && (
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            <button type="button" onClick={() => setMode("new")} className={`flex-1 rounded-md px-3 py-1.5 font-medium ${mode === "new" ? "bg-white shadow-sm" : "text-slate-600"}`}>New guardian</button>
            <button type="button" onClick={() => setMode("existing")} className={`flex-1 rounded-md px-3 py-1.5 font-medium ${mode === "existing" ? "bg-white shadow-sm" : "text-slate-600"}`}>Already on file (sibling)</button>
          </div>
        )}
        {mode === "existing" && !editing ? (
          <div>
            <Field label="Search by name or phone" htmlFor="g-search"><input id="g-search" className="input" value={search} onChange={(e) => { setSearch(e.target.value); setExistingId(""); }} /></Field>
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {matches.length === 0 && <li className="p-3 text-sm text-slate-500">{search ? "No match." : "Start typing to search."}</li>}
              {matches.map((m) => (
                <li key={m.id}>
                  <label className="flex cursor-pointer items-center gap-3 p-3 text-sm hover:bg-slate-50">
                    <input type="radio" name="existing" checked={existingId === m.id} onChange={() => setExistingId(m.id)} />
                    <span className="flex-1 font-medium">{m.fullName}</span>
                    <span className="text-slate-500">{formatPhone(m.phone)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" htmlFor="gm-name"><input id="gm-name" className="input" value={g.fullName} onChange={setGF("fullName")} /></Field>
            <Field label="Phone" htmlFor="gm-phone" hint="Used for SMS and WhatsApp updates"><input id="gm-phone" type="tel" className="input" value={g.phone} onChange={setGF("phone")} placeholder="0803 123 4567" /></Field>
            <Field label="Email" htmlFor="gm-email"><input id="gm-email" type="email" className="input" value={g.email} onChange={setGF("email")} /></Field>
            {editing && <Field label="WhatsApp number" htmlFor="gm-wa" hint="If different from phone"><input id="gm-wa" type="tel" className="input" value={g.whatsappPhone} onChange={setGF("whatsappPhone")} /></Field>}
            <Field label="Occupation" htmlFor="gm-occ"><input id="gm-occ" className="input" value={g.occupation} onChange={setGF("occupation")} /></Field>
            <Field label="Address" htmlFor="gm-addr"><input id="gm-addr" className="input" value={g.address} onChange={setGF("address")} /></Field>
          </div>
        )}
        {flags}
        {!editing && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={createLogin} onChange={(e) => setCreateLogin(e.target.checked)} /> Give this guardian a login to the parent app
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{editing ? "Save" : "Add guardian"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function MedicalForm({ sid, s, medical, canEdit, onDone }: { sid: string; s: Student; medical: Medical | null; canEdit: boolean; onDone: (m: string) => void }) {
  const [f, setF] = useState({
    bloodGroup: medical?.bloodGroup ?? "", genotype: medical?.genotype ?? "", allergies: medical?.allergies ?? "", conditions: medical?.conditions ?? "",
    medications: medical?.medications ?? "", doctor: medical?.doctor ?? "", notes: medical?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("students.setMedical", { schoolId: sid, studentId: s.id, ...f });
      onDone("Medical information saved.");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  if (!canEdit) {
    return (
      <dl className="divide-y divide-slate-100">
        <Row label="Blood group">{medical?.bloodGroup}</Row>
        <Row label="Genotype">{medical?.genotype}</Row>
        <Row label="Allergies">{medical?.allergies}</Row>
        <Row label="Conditions">{medical?.conditions}</Row>
        <Row label="Medication">{medical?.medications}</Row>
        <Row label="Doctor">{medical?.doctor}</Row>
      </dl>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-slate-500">Only school leadership and the child's parents can see these details. Teachers only see a "medical alert" flag when allergies, conditions or medication are recorded.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Blood group" htmlFor="m-bg">
          <select id="m-bg" className="input" value={f.bloodGroup} onChange={set("bloodGroup")}>
            {["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((x) => <option key={x} value={x}>{x || "Unknown"}</option>)}
          </select>
        </Field>
        <Field label="Genotype" htmlFor="m-gt">
          <select id="m-gt" className="input" value={f.genotype} onChange={set("genotype")}>
            {["", "AA", "AS", "AC", "SS", "SC", "CC"].map((x) => <option key={x} value={x}>{x || "Unknown"}</option>)}
          </select>
        </Field>
        <Field label="Allergies" htmlFor="m-al"><textarea id="m-al" className="input" rows={2} value={f.allergies} onChange={set("allergies")} /></Field>
        <Field label="Medical conditions" htmlFor="m-co"><textarea id="m-co" className="input" rows={2} value={f.conditions} onChange={set("conditions")} placeholder="e.g. Asthma, sickle cell" /></Field>
        <Field label="Regular medication" htmlFor="m-me"><textarea id="m-me" className="input" rows={2} value={f.medications} onChange={set("medications")} /></Field>
        <Field label="Family doctor / hospital" htmlFor="m-dr"><textarea id="m-dr" className="input" rows={2} value={f.doctor} onChange={set("doctor")} /></Field>
      </div>
      <Field label="Other notes" htmlFor="m-no"><textarea id="m-no" className="input" rows={2} value={f.notes} onChange={set("notes")} /></Field>
      <div className="flex justify-end"><Button type="submit" loading={busy}>Save medical information</Button></div>
    </form>
  );
}

// ------------------------------------------------------------------ page
export function StudentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { activeSchool, can, roles, profile } = useAuth();
  const sid = activeSchool!.id;
  const isAdmin = can(ADMIN_ROLES);
  const seesAll = can(["proprietor", "principal", "school_admin", "bursar"]);
  const [tab, setTab] = useState<Tab>("details");
  const [modal, setModal] = useState<null | "edit" | "class" | "reinstate" | "withdraw" | "guardian" | { guardian: Guardian; link: GuardianLink }>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const notice = sessionStorage.getItem("wepluz.notice");
    if (notice) {
      sessionStorage.removeItem("wepluz.notice");
      setMsg({ tone: notice.includes("not saved") ? "error" : "success", text: notice });
    }
  }, [id]);

  const data = useAsync(async () => {
    const student = await loadStudent(sid, id!);
    if (!student) return null;
    const isParent = Boolean(profile && student.parentUids.includes(profile.id));
    const [levels, sessions, photo, guardians, medical, enrolments] = await Promise.all([
      loadLevels(sid),
      loadSessions(sid),
      student.hasPhoto ? loadPhoto(sid, student.id) : Promise.resolve(null),
      seesAll || isParent ? loadGuardians(sid, student.guardians.map((g) => g.guardianId)) : Promise.resolve([] as Guardian[]),
      isAdmin || isParent ? loadMedical(sid, student.id).catch(() => null) : Promise.resolve(null),
      seesAll ? loadEnrolments(sid, student.id) : Promise.resolve([]),
    ]);
    return { student, isParent, arms: armOptions(levels), sessions, photo, guardians, medical, enrolments };
  }, [sid, id, seesAll, isAdmin, profile?.id]);

  const done = async (text: string) => {
    setModal(null);
    setMsg({ tone: "success", text });
    await data.reload();
  };

  async function act(fn: () => Promise<unknown>, text: string) {
    setMsg(null);
    try {
      await fn();
      await done(text);
    } catch (err) {
      setMsg({ tone: "error", text: friendlyError(err) });
    }
  }

  async function uploadPhoto(file: File) {
    await act(async () => api("students.setPhoto", { schoolId: sid, studentId: id, dataUrl: await resizeImageToDataUrl(file, 320) }), "Photo updated.");
    if (fileInput.current) fileInput.current.value = "";
  }

  if (data.loading && !data.data) return <FullPageSpinner />;
  if (data.error) return <Alert>{data.error.includes("permission") ? "You do not have access to this student." : data.error}</Alert>;
  if (!data.data) return <EmptyState title="Student not found" />;
  const { student: s, arms, photo, guardians, medical, enrolments, sessions, isParent } = data.data;
  const arm = arms.find((a) => a.id === s.currentArmId);
  const tabs: [Tab, string][] = [["details", "Details"], ["attendance", "Attendance"]];
  if (seesAll || isParent) tabs.push(["guardians", "Parents & guardians"]);
  if (isAdmin || isParent) tabs.push(["medical", "Medical"]);
  if (seesAll) tabs.push(["history", "Class history"]);
  const sessionName = new Map(sessions.map((x) => [x.id, x.name]));
  const armLabel = new Map(arms.map((a) => [a.id, a.label]));
  const backTo = roles.length === 1 && roles[0] === "parent" ? "/parent/children" : "/students";

  return (
    <>
      <Link to={backTo} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Back</Link>
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      <section className="card mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="relative self-start">
          <StudentAvatar student={s} photo={photo} size={80} />
          {isAdmin && (
            <>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadPhoto(e.target.files[0])} />
              <button onClick={() => fileInput.current?.click()} className="absolute -bottom-1 -right-1 rounded-full border border-slate-200 bg-white p-1.5 text-slate-600 shadow-sm hover:text-slate-900" aria-label="Change photo">
                <Camera className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">{fullName(s)}</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {s.admissionNo} · {arm?.label ?? "No class this session"}
            {s.dateOfBirth ? ` · ${ageOn(s.dateOfBirth)} years old` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
            {s.hasMedicalAlert && <MedicalFlag />}
          </div>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setModal("edit")}><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>
            {s.status === "active" ? (
              <>
                <Button variant="secondary" onClick={() => setModal("class")}>Change class</Button>
                <Button variant="ghost" className="text-red-600" onClick={() => setModal("withdraw")}>Withdraw</Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setModal("reinstate")}>Reinstate</Button>
            )}
          </div>
        )}
      </section>

      {s.hasMedicalAlert && !isAdmin && !isParent && (
        <div className="mb-4"><Alert tone="info">This student has a medical alert. Check with the school office for details.</Alert></div>
      )}

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1" role="tablist">
        {tabs.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
            {label}
          </button>
        ))}
        {["Results", "Fees"].map((x) => (
          <span key={x} className="flex items-center gap-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-slate-400" title="Coming soon">{x} <span className="text-[10px] uppercase">soon</span></span>
        ))}
      </div>

      <section className="card p-5">
        {tab === "details" && (
          <dl className="divide-y divide-slate-100">
            <Row label="Full name">{fullName(s)}</Row>
            <Row label="Gender"><span className="capitalize">{s.gender}</span></Row>
            <Row label="Date of birth">{s.dateOfBirth ? `${formatDate(s.dateOfBirth)} (${ageOn(s.dateOfBirth)} years)` : null}</Row>
            <Row label="Class">{arm?.label}</Row>
            <Row label="Admission number">{s.admissionNo}</Row>
            <Row label="Admitted">{formatDate(s.admissionDate)}</Row>
            <Row label="State of origin">{[s.lga, s.stateOfOrigin].filter(Boolean).join(", ")}</Row>
            <Row label="Religion">{s.religion}</Row>
            {s.withdrawal && <Row label="Withdrawn">{`${formatDate(s.withdrawal.date)}: ${s.withdrawal.reason}`}</Row>}
          </dl>
        )}

        {tab === "attendance" && <AttendanceTab sid={sid} studentId={s.id} />}

        {tab === "guardians" && (
          <>
            {isAdmin && (
              <div className="mb-3 flex justify-end">
                <Button variant="secondary" onClick={() => setModal("guardian")}><Plus className="h-4 w-4" aria-hidden /> Add guardian</Button>
              </div>
            )}
            {s.guardians.length === 0 && <p className="text-sm text-slate-500">No parent or guardian recorded yet.</p>}
            <ul className="divide-y divide-slate-100">
              {s.guardians.map((link) => {
                const g = guardians.find((x) => x.id === link.guardianId);
                if (!g) return null;
                return (
                  <li key={link.guardianId} className="flex flex-col gap-2 py-3 md:flex-row md:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {g.fullName} <span className="font-normal text-slate-500">· {link.relationship}</span>
                      </p>
                      <p className="text-sm text-slate-600">{[formatPhone(g.phone), g.email].filter(Boolean).join(" · ")}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {link.isPrimary && <Badge tone="brand">Main contact</Badge>}
                        {link.canPickup && <Badge>Can pick up</Badge>}
                        {link.receivesBilling && <Badge>Gets invoices</Badge>}
                        {g.uid ? <Badge tone="green">Has parent login</Badge> : <Badge tone="amber">No login</Badge>}
                        {g.studentIds.length > 1 && <Badge>{g.studentIds.length} children here</Badge>}
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex flex-wrap gap-2">
                        {!g.uid && (
                          <Button variant="ghost" onClick={() => void act(async () => {
                            const r = await api<{ sendPasswordEmailTo: string | null }>("guardians.enableLogin", { schoolId: sid, guardianId: g.id });
                            if (r.sendPasswordEmailTo) await sendPasswordResetEmail(auth, r.sendPasswordEmailTo, { url: `${window.location.origin}/login` }).catch(() => undefined);
                          }, `${g.fullName} can now sign in to the parent app${g.phone ? " with their phone number" : ""}.`)}>
                            <KeyRound className="h-4 w-4" aria-hidden /> Give login
                          </Button>
                        )}
                        <Button variant="ghost" onClick={() => setModal({ guardian: g, link })}><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>
                        <Button variant="ghost" className="text-red-600" onClick={() => window.confirm(`Remove ${g.fullName} from ${s.firstName}'s guardians?`) && void act(() => api("guardians.unlink", { schoolId: sid, studentId: s.id, guardianId: g.id }), "Guardian removed.")}>
                          <Trash2 className="h-4 w-4" aria-hidden /> Remove
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {tab === "medical" && <MedicalForm key={JSON.stringify(medical)} sid={sid} s={s} medical={medical} canEdit={isAdmin} onDone={(t) => void done(t)} />}

        {tab === "history" && (
          <ul className="divide-y divide-slate-100">
            {enrolments.length === 0 && <li className="py-2 text-sm text-slate-500">No class records.</li>}
            {[...enrolments]
              .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))
              .map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium">{sessionName.get(e.sessionId) ?? e.sessionId}</span>
                  <span className="text-slate-600">{armLabel.get(e.armId) ?? "Class removed"}</span>
                  <Badge tone={e.status === "active" ? "green" : "slate"}>{e.status}</Badge>
                </li>
              ))}
          </ul>
        )}
      </section>

      {modal === "edit" && <EditStudentModal sid={sid} s={s} onClose={() => setModal(null)} onDone={(t) => void done(t)} />}
      {(modal === "class" || modal === "reinstate") && <ClassModal sid={sid} s={s} arms={arms} mode={modal === "class" ? "change" : "reinstate"} onClose={() => setModal(null)} onDone={(t) => void done(t)} />}
      {modal === "withdraw" && <WithdrawModal sid={sid} s={s} onClose={() => setModal(null)} onDone={(t) => void done(t)} />}
      {modal === "guardian" && <GuardianModal sid={sid} s={s} editing={null} onClose={() => setModal(null)} onDone={(t) => void done(t)} />}
      {modal && typeof modal === "object" && <GuardianModal sid={sid} s={s} editing={modal} onClose={() => setModal(null)} onDone={(t) => void done(t)} />}
    </>
  );
}
