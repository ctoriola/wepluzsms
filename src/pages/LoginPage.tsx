import { KeyRound, Smartphone } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Button, Field, SchoolLogo } from "@/components/ui";
import { applyBranding, schoolSlugFromLocation } from "@/lib/branding";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, isDemoMode } from "@/lib/demo";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { friendlyError, isSupabaseConfigured, publicAssetUrl, supabase } from "@/lib/supabase";

type Branding = { name: string; logo_path: string | null; motto: string | null };

const RESEND_SECONDS = 60;

function useSchoolBranding(): Branding | null {
  const [branding, setBranding] = useState<Branding | null>(null);
  useEffect(() => {
    const slug = schoolSlugFromLocation();
    if (!slug || !isSupabaseConfigured) return;
    supabase.rpc("get_school_branding", { p_slug: slug }).then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : null;
      if (row) {
        setBranding({ name: row.name, logo_path: row.logo_path, motto: row.motto });
        applyBranding(row.primary_color, row.accent_color);
      }
    });
  }, []);
  return branding;
}

function StaffLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (error) setError(friendlyError(error));
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <Field label="Email address" htmlFor="email">
        <input id="email" type="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.com" />
      </Field>
      <Field label="Password" htmlFor="password">
        <input id="password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" className="w-full" loading={busy} disabled={!email || !password}>
        Sign in
      </Button>
      <p className="text-center text-sm">
        <Link to="/forgot-password" className="font-medium text-brand hover:underline">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}

function ParentLogin() {
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState<string | null>(null); // set once a code has been sent
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendCode(target: string) {
    setError(null);
    setBusy(true);
    // shouldCreateUser: false - only parents the school has registered can log in.
    const { error } = await supabase.auth.signInWithOtp({ phone: target, options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) {
      setError(friendlyError(error));
      return false;
    }
    setResendIn(RESEND_SECONDS);
    return true;
  }

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizePhone(phoneInput);
    if (!normalized) {
      setError("Enter a valid phone number, for example 0803 123 4567.");
      return;
    }
    if (await sendCode(normalized)) setPhone(normalized);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!phone) return;
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ phone, token: code.trim(), type: "sms" });
    setBusy(false);
    if (error) setError(friendlyError(error));
  }

  if (!phone) {
    return (
      <form onSubmit={requestCode} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Phone number" htmlFor="phone" hint="Use the number you gave the school.">
          <input id="phone" type="tel" inputMode="tel" autoComplete="tel" required className="input" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} placeholder="0803 123 4567" />
        </Field>
        <Button type="submit" className="w-full" loading={busy} disabled={!phoneInput.trim()}>
          Send me a code
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <Alert tone="info">
        We sent a 6-digit code by SMS to <strong>{formatPhone(phone)}</strong>.
      </Alert>
      <Field label="Enter the code" htmlFor="code">
        <input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          className="input text-center text-lg tracking-[0.5em]"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
      </Field>
      <Button type="submit" className="w-full" loading={busy} disabled={code.length !== 6}>
        Verify and sign in
      </Button>
      <div className="flex items-center justify-between text-sm">
        <button type="button" className="text-slate-600 hover:underline" onClick={() => { setPhone(null); setCode(""); setError(null); }}>
          Change number
        </button>
        <button type="button" className="font-medium text-brand hover:underline disabled:text-slate-400 disabled:no-underline" disabled={resendIn > 0 || busy} onClick={() => void sendCode(phone)}>
          {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
        </button>
      </div>
    </form>
  );
}

function DemoAccounts() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(email: string) {
    setError(null);
    setBusy(email);
    const { error } = await supabase.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
    setBusy(null);
    if (error) setError(`${friendlyError(error)} Has the demo seed data been loaded?`);
  }

  return (
    <section className="card mt-4 p-4" aria-labelledby="demo-title">
      <h2 id="demo-title" className="text-sm font-semibold">Try a demo account</h2>
      <p className="mt-0.5 text-xs text-slate-500">One click signs you in as that person. Password for all: {DEMO_PASSWORD}</p>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {DEMO_ACCOUNTS.map((a) => (
          <button
            key={a.email}
            onClick={() => void signIn(a.email)}
            disabled={busy !== null}
            className="rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-brand/40 hover:bg-brand/5 disabled:opacity-50"
          >
            <span className="block text-sm font-medium">{busy === a.email ? "Signing in..." : a.label}</span>
            <span className="block truncate text-xs text-slate-500">{a.who}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function LoginPage() {
  const { session, loading } = useAuth();
  const location = useLocation();
  const branding = useSchoolBranding();
  const [tab, setTab] = useState<"staff" | "parent">("staff");

  if (!loading && session) {
    const from = (location.state as { from?: string } | null)?.from ?? "/";
    return <Navigate to={from} replace />;
  }

  const name = branding?.name ?? "Wepluz School Manager";
  const tabClass = (active: boolean) =>
    `flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`;

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-gradient-to-b from-brand/5 to-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <SchoolLogo url={publicAssetUrl(branding?.logo_path)} name={name} size={64} />
          <h1 className="mt-4 text-xl font-bold text-slate-900">{name}</h1>
          <p className="mt-1 text-sm text-slate-500">{branding?.motto ?? "Sign in to continue"}</p>
        </div>

        {!isSupabaseConfigured && (
          <div className="mb-4">
            <Alert>App not configured: copy .env.example to .env.local and add your Supabase URL and anon key.</Alert>
          </div>
        )}

        <div className="card p-5 sm:p-6">
          <div className="mb-5 flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Sign-in method">
            <button role="tab" aria-selected={tab === "staff"} className={tabClass(tab === "staff")} onClick={() => setTab("staff")}>
              <KeyRound className="h-4 w-4" aria-hidden /> Staff
            </button>
            <button role="tab" aria-selected={tab === "parent"} className={tabClass(tab === "parent")} onClick={() => setTab("parent")}>
              <Smartphone className="h-4 w-4" aria-hidden /> Parent
            </button>
          </div>
          {tab === "staff" ? <StaffLogin /> : <ParentLogin />}
          {isDemoMode && tab === "parent" && (
            <p className="mt-3 text-xs text-slate-500">Demo: SMS codes need Termii. Use the Parent demo account below instead.</p>
          )}
        </div>
        {isDemoMode && <DemoAccounts />}
        <p className="mt-6 text-center text-xs text-slate-400">Powered by MANDEXA</p>
      </div>
    </div>
  );
}
