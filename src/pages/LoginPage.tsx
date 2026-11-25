import { KeyRound, Smartphone } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { WepluzMark } from "@/layout/AppShell";
import { Alert, Button, Field, SchoolLogo } from "@/components/ui";
import { applyBranding, schoolSlugFromLocation } from "@/lib/branding";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, isDemoMode } from "@/lib/demo";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { signInWithCustomToken, signInWithEmailAndPassword } from "firebase/auth";
import { api, friendlyError } from "@/lib/api";
import { auth, isFirebaseConfigured } from "@/lib/firebase";

type Branding = { name: string; logo: string | null; motto: string | null; primaryColor: string; accentColor: string };

const RESEND_SECONDS = 60;

function useSchoolBranding(): Branding | null {
  const [branding, setBranding] = useState<Branding | null>(null);
  useEffect(() => {
    const slug = schoolSlugFromLocation();
    if (!slug || !isFirebaseConfigured) return;
    api<Branding | null>("branding.get", { slug })
      .then((b) => {
        if (b) {
          setBranding(b);
          applyBranding(b.primaryColor, b.accentColor);
        }
      })
      .catch(() => undefined);
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
    try {
      await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
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
    try {
      // Only parents the school has registered can get a code.
      await api("otp.request", { phone: target });
      setResendIn(RESEND_SECONDS);
      return true;
    } catch (err) {
      setError(friendlyError(err));
      return false;
    } finally {
      setBusy(false);
    }
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
    try {
      const { customToken } = await api<{ customToken: string }>("otp.verify", { phone, code: code.trim() });
      await signInWithCustomToken(auth, customToken);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
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
    try {
      await signInWithEmailAndPassword(auth, email, DEMO_PASSWORD);
    } catch (err) {
      setError(`${friendlyError(err)} Has the demo been installed at /setup?`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card mt-6 p-4" aria-labelledby="demo-title">
      <h2 id="demo-title" className="text-sm font-semibold">Try a demo account</h2>
      <p className="mt-0.5 text-xs text-slate-500">One click signs you in as that person. Password for all: {DEMO_PASSWORD}</p>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {DEMO_ACCOUNTS.map((a) => (
          <button
            key={a.email}
            onClick={() => void signIn(a.email)}
            disabled={busy !== null}
            className="rounded-2xl bg-white px-3 py-2.5 text-left ring-1 ring-transparent transition hover:ring-brand/30 disabled:opacity-50"
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
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    api<{ installed: boolean }>("setup.status")
      .then((s) => setInstalled(s.installed))
      .catch(() => undefined);
  }, []);

  if (!loading && session) {
    const from = (location.state as { from?: string } | null)?.from ?? "/";
    return <Navigate to={from} replace />;
  }

  const name = branding?.name ?? "Wepluz School Manager";
  const tabClass = (active: boolean) =>
    `flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition ${active ? "bg-white text-brand shadow-sm" : "text-slate-600 hover:text-ink"}`;

  return (
    <div className="flex min-h-full items-center justify-center bg-mint p-0 sm:p-5">
      <div className="flex min-h-full w-full max-w-5xl overflow-hidden bg-white sm:min-h-[640px] sm:rounded-[2.25rem] sm:shadow-xl sm:shadow-brand/10">
        <aside className="relative hidden w-[42%] flex-col justify-between overflow-hidden bg-brand p-10 text-white lg:flex">
          <div className="flex items-center gap-3">
            <WepluzMark size={40} />
            <span className="text-xl font-semibold">Wepluz</span>
          </div>
          <div className="relative z-10">
            <h2 className="text-4xl font-semibold leading-tight tracking-tight">Run your whole school from one calm place.</h2>
            <p className="mt-4 max-w-sm text-white/75">Students, attendance, results and fees, with parents kept in the loop by SMS and WhatsApp.</p>
          </div>
          <p className="text-sm text-white/60">Powered by MANDEXA</p>
          <span className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-white/5" aria-hidden />
          <span className="pointer-events-none absolute -bottom-8 -right-8 h-36 w-36 rounded-full bg-white/[0.07]" aria-hidden />
        </aside>

        <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-10">
          <div className="w-full max-w-sm">
            <div className="mb-6 flex flex-col items-center text-center">
              {branding ? <SchoolLogo url={branding.logo} name={name} size={64} /> : <WepluzMark size={56} />}
              <h1 className="mt-4 text-2xl font-semibold tracking-tight">{name}</h1>
              <p className="mt-1 text-sm text-slate-500">{branding?.motto ?? "Sign in to continue"}</p>
            </div>

            {!isFirebaseConfigured && (
              <div className="mb-4">
                <Alert>App not configured: add the VITE_FIREBASE_* settings (see .env.example), then redeploy.</Alert>
              </div>
            )}
            {isFirebaseConfigured && !installed && (
              <div className="mb-4">
                <Alert tone="info">
                  Wepluz is not installed on this Firebase project yet. <Link to="/setup" className="font-semibold underline">Open setup</Link>
                </Alert>
              </div>
            )}

            <div className="mb-5 flex gap-1 rounded-full bg-surface p-1" role="tablist" aria-label="Sign-in method">
              <button role="tab" aria-selected={tab === "staff"} className={tabClass(tab === "staff")} onClick={() => setTab("staff")}>
                <KeyRound className="h-4 w-4" aria-hidden /> Staff
              </button>
              <button role="tab" aria-selected={tab === "parent"} className={tabClass(tab === "parent")} onClick={() => setTab("parent")}>
                <Smartphone className="h-4 w-4" aria-hidden /> Parent
              </button>
            </div>
            {tab === "staff" ? <StaffLogin /> : <ParentLogin />}
            {isDemoMode && tab === "parent" && (
              <p className="mt-3 text-xs text-slate-500">Demo: SMS codes need Termii keys on the server. Use the Parent demo account below instead.</p>
            )}
            {isDemoMode && <DemoAccounts />}
            <p className="mt-6 text-center text-xs text-slate-400 lg:hidden">Powered by MANDEXA</p>
          </div>
        </div>
      </div>
    </div>
  );
}
