import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Alert, Button, FullPageSpinner } from "@/components/ui";
import type { Role } from "@/lib/roles";
import { useAuth } from "./AuthProvider";

// Signed-in users with at least one school only.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, loadError, session, activeSchool, isPlatformAdmin, refresh, signOut } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (loadError) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Alert>We could not load your school information. Check your internet connection and try again.</Alert>
        <Button className="mt-4" onClick={() => void refresh()}>Try again</Button>
      </div>
    );
  }
  if (!activeSchool && isPlatformAdmin) {
    // A fresh platform with no schools yet: go and create one.
    if (location.pathname !== "/platform/schools") return <Navigate to="/platform/schools" replace />;
    return <>{children}</>;
  }
  if (!activeSchool) {
    return (
      <div className="mx-auto flex min-h-full max-w-md flex-col justify-center p-6 text-center">
        <h1 className="text-xl font-bold">No school access yet</h1>
        <p className="mt-2 text-sm text-slate-600">
          You are signed in, but you have not been added to any school. Ask your school administrator to invite you, then sign in again.
        </p>
        <Button variant="secondary" className="mx-auto mt-6" onClick={() => void signOut()}>Sign out</Button>
      </div>
    );
  }
  return <>{children}</>;
}

// Hide a page from roles that should not see it. The database enforces the same rules.
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(roles)) {
    return (
      <div className="card mx-auto max-w-lg p-6 text-center">
        <h1 className="text-lg font-semibold">You do not have access to this page</h1>
        <p className="mt-2 text-sm text-slate-600">If you think this is a mistake, contact your school administrator.</p>
      </div>
    );
  }
  return <>{children}</>;
}
