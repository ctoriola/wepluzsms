import { sendPasswordResetEmail } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { Search, UserPlus, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Badge, Button, Field, FullPageSpinner, PageHeader } from "@/components/ui";
import { api, friendlyError } from "@/lib/api";
import { useAsync } from "@/lib/data";
import { auth, db } from "@/lib/firebase";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { manageableRoles, ROLE_LABELS, type Role } from "@/lib/roles";

type Member = { uid: string; fullName: string | null; email: string | null; phone: string | null; roles: Role[]; status: "active" | "suspended" };
type Filter = "staff" | "parents" | "all";

function InvitePanel({ schoolId, allowedRoles, onDone, onClose }: { schoolId: string; allowedRoles: Role[]; onDone: (msg: string) => void; onClose: () => void }) {
  const [fullName, setFullName] = useState("");
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>(allowedRoles.includes("teacher") ? "teacher" : allowedRoles[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (fullName.trim().length < 2) return setError("Enter the person's full name.");
    const normalized = method === "phone" ? normalizePhone(phone) : null;
    if (method === "phone" && !normalized) return setError("Enter a valid phone number, e.g. 0803 123 4567.");
    const cleanEmail = email.trim().toLowerCase();
    if (method === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) return setError("Enter a valid email address.");

    setBusy(true);
    try {
      const out = await api<{ created: boolean; sendPasswordEmail: boolean }>("members.invite", {
        schoolId,
        role,
        fullName: fullName.trim(),
        ...(method === "email" ? { email: cleanEmail } : { phone: normalized }),
      });
      // New staff get Firebase's "set your password" email.
      if (out.sendPasswordEmail) await sendPasswordResetEmail(auth, cleanEmail, { url: `${window.location.origin}/login` }).catch(() => undefined);
      const who = fullName.trim();
      onDone(
        !out.created
          ? `${who} already had an account, so the ${ROLE_LABELS[role]} role was added to it.`
          : method === "email"
            ? `Invite sent to ${cleanEmail}. ${who} will get an email to set a password.`
            : `${who} can now sign in on the Parent tab with ${formatPhone(normalized)} and an SMS code.`,
      );
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mb-6 p-5" aria-labelledby="invite-title">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="invite-title" className="font-semibold">Invite someone</h2>
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close invite form">
          <X className="h-4 w-4" />
        </button>
      </div>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="inv-name">
            <input id="inv-name" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Funmi Adeyemi" />
          </Field>
          <Field label="Role" htmlFor="inv-role">
            <select id="inv-role" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {allowedRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </Field>
        </div>
        <fieldset>
          <legend className="label">How will they sign in?</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="method" checked={method === "email"} onChange={() => setMethod("email")} /> Email and password</label>
            <label className="flex items-center gap-2"><input type="radio" name="method" checked={method === "phone"} onChange={() => setMethod("phone")} /> Phone and SMS code</label>
          </div>
        </fieldset>
        {method === "email" ? (
          <Field label="Email address" htmlFor="inv-email">
            <input id="inv-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        ) : (
          <Field label="Phone number" htmlFor="inv-phone" hint="They will sign in on the Parent tab with a code sent to this number.">
            <input id="inv-phone" type="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 123 4567" />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}><UserPlus className="h-4 w-4" aria-hidden /> Send invite</Button>
        </div>
      </form>
    </section>
  );
}

export function StaffPage() {
  const { activeSchool, roles, isPlatformAdmin, profile } = useAuth();
  const schoolId = activeSchool!.id;
  const allowed = useMemo(() => manageableRoles(roles, isPlatformAdmin), [roles, isPlatformAdmin]);
  const members = useAsync(async () => (await getDocs(collection(db, "schools", schoolId, "members"))).docs.map((d) => d.data() as Member), [schoolId]);
  const [filter, setFilter] = useState<Filter>("staff");
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (members.data ?? [])
      .filter((m) => {
        const isParent = m.roles.includes("parent");
        const isStaff = m.roles.some((r) => r !== "parent");
        if (filter === "staff" && !isStaff) return false;
        if (filter === "parents" && !isParent) return false;
        return !q || [m.fullName, m.email, m.phone, formatPhone(m.phone)].some((v) => v?.toLowerCase().includes(q));
      })
      .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""));
  }, [members.data, filter, query]);

  async function act(m: Member, action: string, payload: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setMessage(null);
    setBusyId(m.uid);
    try {
      await api(action, { schoolId, uid: m.uid, ...payload });
      await members.reload();
    } catch (err) {
      setMessage({ tone: "error", text: friendlyError(err) });
    } finally {
      setBusyId(null);
    }
  }

  if (members.loading && !members.data) return <FullPageSpinner />;

  const filterBtn = (f: Filter, label: string) => (
    <button onClick={() => setFilter(f)} aria-pressed={filter === f} className={`rounded-md px-3 py-1.5 text-sm font-medium ${filter === f ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
      {label}
    </button>
  );

  return (
    <>
      <PageHeader
        title="Staff & access"
        description="Invite people and control what they can see and do."
        actions={allowed.length > 0 && !inviteOpen ? <Button onClick={() => setInviteOpen(true)}><UserPlus className="h-4 w-4" aria-hidden /> Invite</Button> : undefined}
      />
      {members.error && <div className="mb-4"><Alert>{members.error}</Alert></div>}
      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}
      {inviteOpen && (
        <InvitePanel
          schoolId={schoolId}
          allowedRoles={allowed}
          onClose={() => setInviteOpen(false)}
          onDone={(text) => {
            setInviteOpen(false);
            setMessage({ tone: "success", text });
            void members.reload();
          }}
        />
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {filterBtn("staff", "Staff")}
          {filterBtn("parents", "Parents")}
          {filterBtn("all", "Everyone")}
        </div>
        <label className="relative block sm:w-72">
          <span className="sr-only">Search people</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input className="input pl-9" placeholder="Search name, email or phone" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      <div className="card divide-y divide-slate-100">
        {people.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No one matches this view yet.</p>}
        {people.map((m) => {
          const isMe = m.uid === profile?.id;
          const canManage = !isMe && m.roles.every((r) => allowed.includes(r));
          const addable = allowed.filter((r) => !m.roles.includes(r));
          const busy = busyId === m.uid;
          return (
            <div key={m.uid} className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {m.fullName || m.email || formatPhone(m.phone) || "Unnamed"}
                  {isMe && <span className="ml-2 text-xs font-normal text-slate-400">(you)</span>}
                </p>
                <p className="truncate text-sm text-slate-500">{[m.email, formatPhone(m.phone)].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                {m.roles.map((r) => (
                  <span key={r} className="inline-flex items-center gap-1 rounded-full bg-brand/10 py-0.5 pl-2 pr-1 text-xs font-medium text-brand">
                    {ROLE_LABELS[r]}
                    {canManage && m.roles.length > 1 && (
                      <button
                        className="rounded-full p-0.5 hover:bg-brand/20 disabled:opacity-40"
                        disabled={busy}
                        aria-label={`Remove ${ROLE_LABELS[r]} role from ${m.fullName}`}
                        onClick={() => void act(m, "members.setRoles", { roles: m.roles.filter((x) => x !== r) })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
                {m.status === "suspended" && <Badge tone="amber">Suspended</Badge>}
                {canManage && addable.length > 0 && (
                  <select
                    aria-label={`Add a role for ${m.fullName}`}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                    value=""
                    disabled={busy}
                    onChange={(e) => e.target.value && void act(m, "members.setRoles", { roles: [...m.roles, e.target.value] })}
                  >
                    <option value="">+ Role</option>
                    {addable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                )}
                {canManage && (
                  <>
                    <button className="text-xs font-medium text-slate-600 hover:underline disabled:opacity-50" disabled={busy} onClick={() => void act(m, "members.setStatus", { status: m.status === "active" ? "suspended" : "active" })}>
                      {m.status === "active" ? "Suspend" : "Reactivate"}
                    </button>
                    <button
                      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void act(m, "members.remove", {}, `Remove ${m.fullName ?? "this person"} from ${activeSchool!.name}?`)}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
