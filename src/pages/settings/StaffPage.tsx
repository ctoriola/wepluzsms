import { Search, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Badge, Button, Field, FullPageSpinner, PageHeader } from "@/components/ui";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { manageableRoles, ROLE_LABELS, type Role } from "@/lib/roles";
import { friendlyError, supabase } from "@/lib/supabase";

type MembershipRow = {
  id: string;
  user_id: string;
  role: Role;
  status: "active" | "suspended";
  created_at: string;
  profiles: { full_name: string | null; email: string | null; phone: string | null } | null;
};

type Person = {
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  memberships: MembershipRow[];
};

type Filter = "staff" | "parents" | "all";

async function invokeError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch {
      /* fall through */
    }
  }
  return friendlyError(error);
}

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
    if (method === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("Enter a valid email address.");

    setBusy(true);
    const { data, error } = await supabase.functions.invoke("invite-member", {
      body: {
        school_id: schoolId,
        role,
        full_name: fullName.trim(),
        ...(method === "email" ? { email: email.trim().toLowerCase() } : { phone: normalized }),
      },
    });
    setBusy(false);
    if (error) return setError(await invokeError(error));

    const who = fullName.trim();
    onDone(
      data?.created === false
        ? `${who} already had an account, so the ${ROLE_LABELS[role]} role was added to it.`
        : method === "email"
          ? `Invite sent to ${email.trim()}. ${who} will get an email to set a password.`
          : `${who} can now sign in on the Parent tab with ${formatPhone(normalized)} and an SMS code.`,
    );
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
              {allowedRoles.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </Field>
        </div>
        <fieldset>
          <legend className="label">How will they sign in?</legend>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="method" checked={method === "email"} onChange={() => setMethod("email")} /> Email and password
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="method" checked={method === "phone"} onChange={() => setMethod("phone")} /> Phone and SMS code
            </label>
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
          <Button type="submit" loading={busy}>
            <UserPlus className="h-4 w-4" aria-hidden /> Send invite
          </Button>
        </div>
      </form>
    </section>
  );
}

export function StaffPage() {
  const { activeSchool, roles, isPlatformAdmin, profile } = useAuth();
  const schoolId = activeSchool!.id;
  const allowed = useMemo(() => manageableRoles(roles, isPlatformAdmin), [roles, isPlatformAdmin]);
  const [rows, setRows] = useState<MembershipRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>("staff");
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("school_memberships")
      .select("id, user_id, role, status, created_at, profiles!school_memberships_user_id_fkey(full_name, email, phone)")
      .eq("school_id", schoolId)
      .order("created_at");
    if (error) setMessage({ tone: "error", text: friendlyError(error) });
    setRows((data ?? []) as unknown as MembershipRow[]);
  }, [schoolId]);

  useEffect(() => {
    void load();
  }, [load]);

  const people = useMemo(() => {
    const map = new Map<string, Person>();
    for (const m of rows ?? []) {
      const p = map.get(m.user_id) ?? {
        user_id: m.user_id,
        name: m.profiles?.full_name || m.profiles?.email || formatPhone(m.profiles?.phone) || "Unnamed",
        email: m.profiles?.email ?? null,
        phone: m.profiles?.phone ?? null,
        memberships: [],
      };
      p.memberships.push(m);
      map.set(m.user_id, p);
    }
    const q = query.trim().toLowerCase();
    return [...map.values()]
      .filter((p) => {
        const isParent = p.memberships.some((m) => m.role === "parent");
        const isStaff = p.memberships.some((m) => m.role !== "parent");
        if (filter === "staff" && !isStaff) return false;
        if (filter === "parents" && !isParent) return false;
        return !q || [p.name, p.email, p.phone, formatPhone(p.phone)].some((v) => v?.toLowerCase().includes(q));
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, filter, query]);

  async function act(m: MembershipRow, action: "suspend" | "reactivate" | "remove" | Role) {
    setMessage(null);
    if (action === "remove" && !window.confirm(`Remove the ${ROLE_LABELS[m.role]} role from this person?`)) return;
    setBusyId(m.id);
    const q = supabase.from("school_memberships");
    const { error, count } =
      action === "remove"
        ? await q.delete({ count: "exact" }).eq("id", m.id)
        : action === "suspend" || action === "reactivate"
          ? await q.update({ status: action === "suspend" ? "suspended" : "active" }, { count: "exact" }).eq("id", m.id)
          : await q.update({ role: action }, { count: "exact" }).eq("id", m.id);
    setBusyId(null);
    if (error) {
      const text = error.code === "23505" ? "This person already has that role." : friendlyError(error);
      setMessage({ tone: "error", text });
    } else if (count === 0) {
      setMessage({ tone: "error", text: "You do not have permission to change this person's access." });
    } else {
      await load();
    }
  }

  if (rows === null) return <FullPageSpinner />;

  const filterBtn = (f: Filter, label: string) => (
    <button
      onClick={() => setFilter(f)}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${filter === f ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
      aria-pressed={filter === f}
    >
      {label}
    </button>
  );

  return (
    <>
      <PageHeader
        title="Staff & access"
        description="Invite people and control what they can see and do."
        actions={
          allowed.length > 0 && !inviteOpen ? (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" aria-hidden /> Invite
            </Button>
          ) : undefined
        }
      />
      {message && (
        <div className="mb-4">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      )}
      {inviteOpen && (
        <InvitePanel
          schoolId={schoolId}
          allowedRoles={allowed}
          onClose={() => setInviteOpen(false)}
          onDone={(text) => {
            setInviteOpen(false);
            setMessage({ tone: "success", text });
            void load();
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
        {people.map((p) => (
          <div key={p.user_id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {p.name}
                {p.user_id === profile?.id && <span className="ml-2 text-xs font-normal text-slate-400">(you)</span>}
              </p>
              <p className="truncate text-sm text-slate-500">{[p.email, formatPhone(p.phone)].filter(Boolean).join(" · ")}</p>
            </div>
            <div className="flex flex-col gap-2 md:items-end">
              {p.memberships.map((m) => {
                const canManage = allowed.includes(m.role) && m.user_id !== profile?.id;
                return (
                  <div key={m.id} className="flex flex-wrap items-center gap-2">
                    {canManage ? (
                      <select
                        aria-label={`Role for ${p.name}`}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                        value={m.role}
                        disabled={busyId === m.id}
                        onChange={(e) => void act(m, e.target.value as Role)}
                      >
                        {allowed.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    ) : (
                      <Badge tone="brand">{ROLE_LABELS[m.role]}</Badge>
                    )}
                    {m.status === "suspended" && <Badge tone="amber">Suspended</Badge>}
                    {canManage && (
                      <>
                        <button
                          className="text-xs font-medium text-slate-600 hover:underline disabled:opacity-50"
                          disabled={busyId === m.id}
                          onClick={() => void act(m, m.status === "active" ? "suspend" : "reactivate")}
                        >
                          {m.status === "active" ? "Suspend" : "Reactivate"}
                        </button>
                        <button className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50" disabled={busyId === m.id} onClick={() => void act(m, "remove")}>
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
