import { ImagePlus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Button, Field, FullPageSpinner, PageHeader, SchoolLogo } from "@/components/ui";
import { resizeImageToWebp } from "@/lib/image";
import { normalizePhone, formatPhone } from "@/lib/phone";
import { friendlyError, publicAssetUrl, SCHOOL_ASSETS_BUCKET, supabase } from "@/lib/supabase";

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
  const { activeSchool, refresh } = useAuth();
  const schoolId = activeSchool!.id;
  const [form, setForm] = useState<Form>(EMPTY);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [school, settings] = await Promise.all([
        supabase.from("schools").select("name").eq("id", schoolId).single(),
        supabase.from("school_settings").select("*").eq("school_id", schoolId).single(),
      ]);
      if (cancelled) return;
      if (school.error || settings.error) {
        setMessage({ tone: "error", text: friendlyError(school.error ?? settings.error) });
      } else {
        const s = settings.data;
        setForm({
          name: school.data.name,
          motto: s.motto ?? "",
          address: s.address ?? "",
          city: s.city ?? "",
          state: s.state ?? "",
          phone: formatPhone(s.phone),
          email: s.email ?? "",
          website: s.website ?? "",
          primary_color: s.primary_color,
          accent_color: s.accent_color,
        });
        setLogoPath(s.logo_path);
      }
      setLoading(false);
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
    const nameRes = await supabase.from("schools").update({ name: form.name.trim() }).eq("id", schoolId);
    const settingsRes = await supabase
      .from("school_settings")
      .update({
        motto: form.motto.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        state: form.state || null,
        phone,
        email: form.email.trim().toLowerCase() || null,
        website: form.website.trim() || null,
        primary_color: form.primary_color,
        accent_color: form.accent_color,
      })
      .eq("school_id", schoolId);
    setSaving(false);

    const error = nameRes.error ?? settingsRes.error;
    if (error) {
      setMessage({ tone: "error", text: friendlyError(error) });
    } else {
      setMessage({ tone: "success", text: "School profile saved." });
      await refresh();
    }
  }

  async function uploadLogo(file: File) {
    setMessage(null);
    setUploading(true);
    try {
      const blob = await resizeImageToWebp(file, 512);
      const path = `${schoolId}/logo-${Date.now()}.webp`;
      const { error: upErr } = await supabase.storage.from(SCHOOL_ASSETS_BUCKET).upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase.from("school_settings").update({ logo_path: path }).eq("school_id", schoolId);
      if (dbErr) throw dbErr;
      if (logoPath) await supabase.storage.from(SCHOOL_ASSETS_BUCKET).remove([logoPath]); // best effort
      setLogoPath(path);
      setMessage({ tone: "success", text: "Logo updated." });
      await refresh();
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
        <SchoolLogo url={publicAssetUrl(logoPath)} name={form.name || "School"} size={80} />
        <div className="flex-1">
          <h2 className="font-semibold">School logo</h2>
          <p className="mt-1 text-sm text-slate-500">PNG, JPG or WebP. A square image works best. We resize it automatically.</p>
        </div>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadLogo(e.target.files[0])} />
        <Button variant="secondary" loading={uploading} onClick={() => fileInput.current?.click()}>
          <ImagePlus className="h-4 w-4" aria-hidden /> {logoPath ? "Change logo" : "Upload logo"}
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
