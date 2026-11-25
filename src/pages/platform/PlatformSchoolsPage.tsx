import { collection, getDocs } from "firebase/firestore";
import { Plus, RefreshCw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Badge, Button, Field, FullPageSpinner, Modal, PageHeader } from "@/components/ui";
import { api, friendlyError } from "@/lib/api";
import { useAsync } from "@/lib/data";
import { db } from "@/lib/firebase";

type SchoolRow = { id: string; name: string; slug: string; shortCode: string; status: string };

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
const codeOf = (s: string) => s.toUpperCase().replace(/[^A-Z ]/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 4) || "SCH";

// MANDEXA platform admins: list every school and onboard new ones.
export function PlatformSchoolsPage() {
  const { switchSchool, refresh } = useAuth();
  const schools = useAsync(
    async () => (await getDocs(collection(db, "schools"))).docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SchoolRow, "id">) })).sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", shortCode: "" });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const status = useAsync(() => api<{ dataVersion: number | null; latestDataVersion: number }>("setup.status"), []);
  const needsUpgrade = Boolean(status.data?.dataVersion && status.data.dataVersion < status.data.latestDataVersion);

  async function upgrade() {
    setUpgrading(true);
    setMessage(null);
    try {
      const r = await api<{ done: string[] }>("setup.upgrade");
      setMessage({ tone: "success", text: r.done.length ? `Data updated. ${r.done.join(" ")}` : "Everything is already up to date." });
      await status.reload();
      await refresh();
    } catch (err) {
      setMessage({ tone: "error", text: friendlyError(err) });
    } finally {
      setUpgrading(false);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { id } = await api<{ id: string }>("schools.create", form);
      setOpen(false);
      setMessage({ tone: "success", text: `${form.name} created. Open it and invite its proprietor under Staff & access.` });
      await schools.reload();
      await refresh();
      await switchSchool(id);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function syncRules() {
    setSyncing(true);
    setMessage(null);
    try {
      const r = await api<{ rules: string }>("setup.syncRules");
      setMessage({ tone: "success", text: r.rules === "emulator" ? "Running on the local emulator: rules load from firestore.rules automatically." : "Security rules published." });
    } catch (err) {
      setMessage({ tone: "error", text: friendlyError(err) });
    } finally {
      setSyncing(false);
    }
  }

  if (schools.loading && !schools.data) return <FullPageSpinner />;

  return (
    <>
      <PageHeader
        title="Schools"
        description="Every school on the platform. Create a school, then open it to invite its proprietor."
        actions={
          <>
            <Button variant="secondary" loading={syncing} onClick={() => void syncRules()}><RefreshCw className="h-4 w-4" aria-hidden /> Publish rules</Button>
            <Button onClick={() => { setForm({ name: "", slug: "", shortCode: "" }); setError(null); setOpen(true); }}><Plus className="h-4 w-4" aria-hidden /> School</Button>
          </>
        }
      />
      {needsUpgrade && (
        <div className="card mb-4 flex flex-col gap-3 border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm text-amber-900">
            A new version of Wepluz was deployed. Run the data update once so existing schools get the new features (e.g. teacher class lists for student records).
          </p>
          <Button loading={upgrading} onClick={() => void upgrade()}>Run data updates</Button>
        </div>
      )}
      {schools.error && <div className="mb-4"><Alert>{schools.error}</Alert></div>}
      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}
      <div className="card divide-y divide-slate-100">
        {schools.data?.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No schools yet. Create the first one.</p>}
        {schools.data?.map((s) => (
          <div key={s.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="font-medium">{s.name}</p>
              <p className="text-sm text-slate-500">{s.slug} · {s.shortCode}</p>
            </div>
            {s.status !== "active" && <Badge tone="amber">{s.status}</Badge>}
            <Button variant="secondary" onClick={() => void switchSchool(s.id)}>Open</Button>
          </div>
        ))}
      </div>

      {open && (
        <Modal title="New school" onClose={() => setOpen(false)}>
          <form onSubmit={create} className="space-y-4">
            {error && <Alert>{error}</Alert>}
            <Field label="School name" htmlFor="sc-name">
              <input id="sc-name" className="input" value={form.name} onChange={(e) => setForm({ name: e.target.value, slug: slugify(e.target.value), shortCode: codeOf(e.target.value) })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Web name" htmlFor="sc-slug" hint="Used in the school's login link">
                <input id="sc-slug" className="input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} />
              </Field>
              <Field label="Short code" htmlFor="sc-code" hint="For admission numbers">
                <input id="sc-code" className="input uppercase" value={form.shortCode} onChange={(e) => setForm({ ...form, shortCode: e.target.value.toUpperCase() })} />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={busy}>Create school</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
