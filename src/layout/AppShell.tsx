import { ChevronsUpDown, LogOut, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, SchoolLogo } from "@/components/ui";
import { isDemoMode } from "@/lib/demo";
import { ROLE_LABELS } from "@/lib/roles";
import { navFor } from "./nav";

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can, isPlatformAdmin, activeSchool } = useAuth();
  const sections = navFor(can, isPlatformAdmin, Boolean(activeSchool));
  return (
    <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {sections.map((section, i) => (
        <div key={section.title ?? i}>
          {section.title && <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-white/50">{section.title}</p>}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              if (item.comingIn) {
                return (
                  <li key={item.to}>
                    <span className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/40" title={`Coming in ${item.comingIn}`}>
                      <Icon className="h-4 w-4" aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase">Soon</span>
                    </span>
                  </li>
                );
              }
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === "/"}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? "bg-white/15 text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`
                    }
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {item.label}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SchoolSwitcher() {
  const { schools, activeSchool, switchSchool, currentTerm } = useAuth();
  if (!activeSchool) return null;
  const logo = activeSchool.logo;
  return (
    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
      <SchoolLogo url={logo} name={activeSchool.name} size={40} />
      <div className="min-w-0 flex-1">
        {schools.length > 1 ? (
          <label className="relative block">
            <span className="sr-only">Switch school</span>
            <select
              value={activeSchool.id}
              onChange={(e) => void switchSchool(e.target.value)}
              className="w-full cursor-pointer appearance-none truncate bg-transparent pr-5 text-sm font-semibold text-white focus:outline-none"
            >
              {schools.map((s) => (
                <option key={s.id} value={s.id} className="text-slate-900">
                  {s.name}
                </option>
              ))}
            </select>
            <ChevronsUpDown className="pointer-events-none absolute right-0 top-0.5 h-4 w-4 text-white/60" aria-hidden />
          </label>
        ) : (
          <p className="truncate text-sm font-semibold text-white">{activeSchool.name}</p>
        )}
        <p className="truncate text-xs text-white/60">
          {currentTerm ? `${currentTerm.name} · ${currentTerm.session_name}` : activeSchool.motto ?? "No current term set"}
        </p>
      </div>
    </div>
  );
}

function UserBlock() {
  const { profile, roles, isPlatformAdmin, signOut } = useAuth();
  const name = profile?.full_name || profile?.email || profile?.phone || "Signed in";
  return (
    <div className="border-t border-white/10 p-4">
      <p className="truncate text-sm font-medium text-white">{name}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {isPlatformAdmin && <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[11px] font-medium text-amber-200">Platform admin</span>}
        {roles.map((r) => (
          <span key={r} className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-white/80">
            {ROLE_LABELS[r]}
          </span>
        ))}
      </div>
      <button
        onClick={() => void signOut()}
        className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <LogOut className="h-4 w-4" aria-hidden /> Sign out
      </button>
    </div>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { activeSchool, roles, currentTerm } = useAuth();

  useEffect(() => setOpen(false), [location.pathname]);

  const panel = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col bg-brand">
      <SchoolSwitcher />
      <Sidebar onNavigate={onNavigate} />
      <UserBlock />
    </div>
  );

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 lg:block">{panel()}</aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-2 top-2 z-10 rounded-lg p-2 text-white/80 hover:bg-white/10"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            {panel(() => setOpen(false))}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {isDemoMode && (
          <div className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900" role="note">
            Demo mode: sample data only. Do not enter real student or parent information.
          </div>
        )}
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{activeSchool?.name}</p>
            {currentTerm && <p className="truncate text-xs text-slate-500">{currentTerm.name} · {currentTerm.session_name}</p>}
          </div>
          {roles[0] && <Badge tone="brand">{ROLE_LABELS[roles[0]]}</Badge>}
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
