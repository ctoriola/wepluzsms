import { CheckCircle2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Field, FullPageSpinner } from "@/components/ui";
import { api, friendlyError } from "@/lib/api";
import { useAsync } from "@/lib/data";

type Status = { installed: boolean; mode: string | null; configured: boolean };

// One-click installation. Replaces running database migrations by hand:
// it publishes the security rules and creates either the demo school or your
// first platform admin account.
export function SetupPage() {
  const status = useAsync(() => api<Status>("setup.status"), []);
  const [mode, setMode] = useState<"demo" | "production">("demo");
  const [setupToken, setSetupToken] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"demo" | "production" | null>(null);

  async function install(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("setup.install", mode === "demo" ? { mode, setupToken } : { mode, setupToken, fullName, email: email.trim().toLowerCase(), password });
      setDone(mode);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const card = (children: React.ReactNode) => (
    <div className="flex min-h-full items-center justify-center bg-mint px-4 py-10">
      <div className="w-full max-w-lg rounded-[2rem] bg-white p-7 shadow-xl shadow-brand/10">{children}</div>
    </div>
  );

  if (status.loading) return <FullPageSpinner label="Checking installation..." />;
  if (status.error) return card(<><h1 className="text-lg font-bold">Setup</h1><div className="mt-4"><Alert>{status.error} Check the server settings in Vercel (FIREBASE_SERVICE_ACCOUNT).</Alert></div></>);

  if (done || status.data?.installed) {
    const demo = done === "demo" || status.data?.mode === "demo";
    return card(
      <div className="text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-brand" aria-hidden />
        <h1 className="mt-3 text-lg font-bold">{done ? "Wepluz is installed" : "Wepluz is already installed"}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {demo
            ? "The demo schools and accounts are ready. On the sign-in page, use the demo buttons (VITE_DEMO_MODE=true) or sign in with proprietor@demo.test and Password123!"
            : "Sign in with the platform admin account, then create your first school under Platform > Schools."}
        </p>
        <Link to="/login"><Button className="mt-5">Go to sign in</Button></Link>
      </div>,
    );
  }

  return card(
    <>
      <h1 className="text-xl font-bold">Set up Wepluz</h1>
      <p className="mt-1 text-sm text-slate-600">This connects the app to your Firebase project: it publishes the security rules and creates your first data. It runs once.</p>
      {!status.data?.configured && (
        <div className="mt-4"><Alert>The server has no SETUP_TOKEN yet. Add it in Vercel (Settings &gt; Environment Variables), redeploy, then reload this page.</Alert></div>
      )}
      <form onSubmit={install} className="mt-5 space-y-4">
        {error && <Alert>{error}</Alert>}
        <fieldset className="space-y-2">
          <legend className="label">What do you want to install?</legend>
          <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${mode === "demo" ? "border-brand bg-brand/5" : "border-slate-200"}`}>
            <input type="radio" name="mode" checked={mode === "demo"} onChange={() => setMode("demo")} className="mt-0.5" />
            <span><span className="font-medium">Demo</span><span className="block text-slate-500">Two sample schools, every role, a full calendar, classes and subjects. Password for all demo accounts: Password123!</span></span>
          </label>
          <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${mode === "production" ? "border-brand bg-brand/5" : "border-slate-200"}`}>
            <input type="radio" name="mode" checked={mode === "production"} onChange={() => setMode("production")} className="mt-0.5" />
            <span><span className="font-medium">Real schools</span><span className="block text-slate-500">Empty system. Creates your MANDEXA platform admin account; you then add schools.</span></span>
          </label>
        </fieldset>
        <Field label="Setup token" htmlFor="token" hint="The SETUP_TOKEN value you added in Vercel.">
          <input id="token" type="password" className="input" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} autoComplete="off" />
        </Field>
        {mode === "production" && (
          <>
            <Field label="Your full name" htmlFor="fn"><input id="fn" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
            <Field label="Your email" htmlFor="em"><input id="em" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Choose a password" htmlFor="pw" hint="At least 10 characters."><input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
          </>
        )}
        <Button type="submit" className="w-full" loading={busy} disabled={!setupToken}>
          {mode === "demo" ? "Install demo" : "Install"}
        </Button>
        {busy && <p className="text-center text-xs text-slate-500">This can take up to a minute.</p>}
      </form>
    </>,
  );
}
