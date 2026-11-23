import { ImagePlus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Button, Field, FullPageSpinner, PageHeader, SchoolLogo } from "@/components/ui";
import { doc, getDoc } from "firebase/firestore";
import { api, friendlyError } from "@/lib/api";
import { db } from "@/lib/firebase";
import { resizeImageToDataUrl } from "@/lib/image";
import { normalizePhone, formatPhone } from "@/lib/phone";

const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta",
  "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
  "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
  "Taraba", "Yobe", "Zamfara",
];

type Form = {
  name: string;
  motto: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  email: string;
  website: string;
  primary_color: string;
  accent_color: string;
};

const EMPTY: Form = { name: "", motto: "", address: "", city: "", state: "", phone: "", email: "", website: "", primary_color: "#14213D", accent_color: "#0F766E" };

export function SchoolProfilePage() {
  const { activeSchool } = useAuth();
  const schoolId = activeSchool!.id;
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const school = (await getDoc(doc(db, "schools", schoolId))).data();
        if (cancelled || !school) return;
        const s = school.settings ?? {};
        setForm({
          name: school.name,
          motto: s.motto ?? "",
          address: s.address ?? "",
          city: s.city ?? "",
          state: s.state ?? "",
          phone: formatPhone(s.phone),
          email: s.email ?? "",
          website: s.website ?? "",
          primary_color: s.primaryColor ?? "#14213D",
          accent_color: s.accentColor ?? "#0F766E",
        });
      } catch (err) {
        if (!cancelled) setMessage({ tone: "error", text: friendlyError(err) });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  const set = (key: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const phone = form.phone.trim() ? normalizePhone(form.phone) : null;
    if (form.phone.trim() && !phone) return setMessage({ tone: "error", text: "Enter a valid phone number, e.g. 0803 123 4567." });
    if (form.name.trim().length < 2) return setMessage({ tone: "error", text: "Enter the school name." });

    setSaving(true);
    try {
      await api("schools.update", {
        schoolId,
        name: form.name.trim(),
        settings: {
          motto: form.motto.trim() || null,
          address: form.address.trim() || null,
          city: form.city.trim() || null,
          state: form.state || null,
          phone,
          email: form.email.trim().toLowerCase() || null,
          website: form.website.trim() || null,
          primaryColor: form.primary_color,
          accentColor: form.accent_color,
        },
      });
      setMessage({ tone: "success", text: "School profile saved." });
    } catch (err) {
      setMessage({ tone: "error", text: friendlyError(err) });
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    setMessage(null);
    setUploading(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      await api("schools.setLogo", { schoolId, dataUrl });
      setMessage({ tone: "success", text: "Logo updated." });
    } catch (err) {
      setMessage({ tone: "error", text: friendlyError(err) });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  if (loading) return <FullPageSpinner />;

  return (
    <>
      <PageHeader title="School profile" description="This information appears on report cards, receipts and the parent app." />
      {message && (
        <div className="mb-4">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      )}

      <section className="card mb-6 flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center">
        <SchoolLogo url={activeSchool?.logo ?? null} name={form.name || "School"} size={80} />
        <div className="flex-1">
          <h2 className="font-semibold">School logo</h2>
          <p className="mt-1 text-sm text-slate-500">PNG, JPG or WebP. A square image works best. We resize it automatically.</p>
        </div>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadLogo(e.target.files[0])} />
        <Button variant="secondary" loading={uploading} onClick={() => fileInput.current?.click()}>
          <ImagePlus className="h-4 w-4" aria-hidden /> {activeSchool?.logo ? "Change logo" : "Upload logo"}
        </Button>
      </section>

      <form onSubmit={save} className="card space-y-5 p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="School name" htmlFor="name">
            <input id="name" className="input" value={form.name} onChange={set("name")} required />
          </Field>
          <Field label="Motto" htmlFor="motto">
            <input id="motto" className="input" value={form.motto} onChange={set("motto")} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address" htmlFor="address">
              <input id="address" className="input" value={form.address} onChange={set("address")} />
            </Field>
          </div>
          <Field label="City / town" htmlFor="city">
            <input id="city" className="input" value={form.city} onChange={set("city")} />
          </Field>
          <Field label="State" htmlFor="state">
            <select id="state" className="input" value={form.state} onChange={set("state")}>
              <option value="">Select state</option>
              {NIGERIAN_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Phone" htmlFor="phone">
            <input id="phone" type="tel" className="input" value={form.phone} onChange={set("phone")} placeholder="0803 123 4567" />
          </Field>
          <Field label="Email" htmlFor="email">
            <input id="email" type="email" className="input" value={form.email} onChange={set("email")} placeholder="info@school.com" />
          </Field>
          <Field label="Website" htmlFor="website">
            <input id="website" className="input" value={form.website} onChange={set("website")} placeholder="www.school.com" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Main colour" htmlFor="primary">
              <input id="primary" type="color" className="h-11 w-full cursor-pointer rounded-lg border border-slate-300 bg-white p-1" value={form.primary_color} onChange={set("primary_color")} />
            </Field>
            <Field label="Accent colour" htmlFor="accent">
              <input id="accent" type="color" className="h-11 w-full cursor-pointer rounded-lg border border-slate-300 bg-white p-1" value={form.accent_color} onChange={set("accent_color")} />
            </Field>
          </div>
        </div>
        <div className="flex justify-end border-t border-slate-100 pt-4">
          <Button type="submit" loading={saving}>Save changes</Button>
        </div>
      </form>
    </>
  );
}
