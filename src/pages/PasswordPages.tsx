import { sendPasswordResetEmail } from "firebase/auth";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Field } from "@/components/ui";
import { friendlyError } from "@/lib/api";
import { auth } from "@/lib/firebase";
import { WepluzMark } from "@/layout/AppShell";

function AuthCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-mint px-4 py-10">
      <div className="w-full max-w-sm rounded-[2rem] bg-white p-7 shadow-xl shadow-brand/10">
        <WepluzMark size={40} />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

// Firebase emails a secure link; the person sets a new password on Firebase's
// page, then comes back here to sign in. Invited staff use the same flow.
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim().toLowerCase(), { url: `${window.location.origin}/login` });
      setSent(true);
    } catch (err) {
      const code = (err as { code?: string }).code;
      // Do not reveal whether the email exists.
      if (code === "auth/user-not-found" || code === "auth/invalid-email") setSent(true);
      else setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
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
