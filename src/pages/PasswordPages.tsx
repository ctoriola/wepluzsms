import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Button, Field, FullPageSpinner } from "@/components/ui";
import { friendlyError, supabase } from "@/lib/supabase";

function AuthCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 px-4 py-10">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-bold">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/set-password`,
    });
    setBusy(false);
    // Do not reveal whether the email exists; only surface connection/rate-limit problems.
    if (error && /fetch|network|rate|too many/i.test(error.message)) setError(friendlyError(error));
    else setSent(true);
  }

  return (
    <AuthCard title="Reset your password" description="Enter your staff email and we'll send you a link to set a new password.">
      {sent ? (
        <Alert tone="success">If an account exists for {email}, a reset link is on its way. Check your inbox and spam folder.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Email address" htmlFor="email">
            <input id="email" type="email" required autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={!email}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm">
        <Link to="/login" className="font-medium text-brand hover:underline">Back to sign in</Link>
      </p>
    </AuthCard>
  );
}

// Used by both invite links (new staff) and password-reset links.
export function SetPasswordPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <FullPageSpinner />;
  if (!session) {
    return (
      <AuthCard title="Link expired" description="This link is no longer valid. Links expire after a short time and can only be used once.">
        <Link to="/forgot-password"><Button className="w-full">Request a new link</Button></Link>
      </AuthCard>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(friendlyError(error));
    else navigate("/", { replace: true });
  }

  return (
    <AuthCard title="Set your password" description={`Choose a password for ${session.user.email ?? "your account"}.`}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="New password" htmlFor="pw" hint="At least 8 characters.">
          <input id="pw" type="password" autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password" htmlFor="pw2">
          <input id="pw2" type="password" autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" loading={busy} disabled={!password || !confirm}>
          Save password and continue
        </Button>
      </form>
    </AuthCard>
  );
}
