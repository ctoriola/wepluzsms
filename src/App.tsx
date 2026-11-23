import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/auth/AuthProvider";
import { RequireAuth, RequireRole } from "@/auth/guards";
import { AppShell } from "@/layout/AppShell";
import { ADMIN_ROLES } from "@/lib/roles";
import { DashboardPage } from "@/pages/DashboardPage";
import { LoginPage } from "@/pages/LoginPage";
import { ForgotPasswordPage, SetPasswordPage } from "@/pages/PasswordPages";
import { SchoolProfilePage } from "@/pages/settings/SchoolProfilePage";
import { StaffPage } from "@/pages/settings/StaffPage";

function NotFound() {
  return (
    <div className="card mx-auto max-w-md p-6 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <Link to="/" className="mt-3 inline-block text-sm font-medium text-brand hover:underline">
        Go to dashboard
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/set-password" element={<SetPasswordPage />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="settings/school" element={<RequireRole roles={ADMIN_ROLES}><SchoolProfilePage /></RequireRole>} />
            <Route path="settings/staff" element={<RequireRole roles={ADMIN_ROLES}><StaffPage /></RequireRole>} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
