import { ChevronDown, ChevronsUpDown, LogOut, Menu, Search, Settings, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { SchoolLogo } from "@/components/ui";
import { isDemoMode } from "@/lib/demo";
import { ADMIN_ROLES, ROLE_LABELS, STAFF_ROLES } from "@/lib/roles";
import { navFor, type NavItem } from "./nav";

/** Wepluz mark: a sunflower diamond (product identity, not the school's). */
export function WepluzMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <rect x="6" y="6" width="28" height="28" rx="8" transform="rotate(45 20 20)" fill="#F5C448" />
      <path d="M13 16l3.5 9 3.5-6.5 3.5 6.5 3.5-9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { can, isPlatformAdmin, activeSchool } = useAuth();
  const sections = navFor(can, isPlatformAdmin, Boolean(activeSchool));
  return (
    <nav aria-label="Main" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4 [mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)]">
      {sections.map((section, i) => (
        <div key={section.title ?? i}>
          {section.title && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/55">{section.title}</p>}
          <ul className="space-y-1">
            {section.items.map((item) => {
              const Icon = item.icon;
              if (item.comingIn) {
                return (
                  <li key={item.to}>
                    <span className="flex cursor-default items-center gap-3 rounded-2xl px-3 py-2 text-sm text-white/45" title={`Coming in ${item.comingIn}`}>
                      <Icon className="h-[18px] w-[18px]" aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Soon</span>
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
                      `flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition ${isActive ? "bg-white text-brand shadow-sm" : "text-white/85 hover:bg-white/10 hover:text-white"}`
                    }
                  >
                    <Icon className="h-[18px] w-[18px]" aria-hidden />
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
  return (
    <div className="mx-3 flex items-center gap-3 rounded-2xl bg-white/10 p-3">
      <SchoolLogo url={activeSchool.logo} name={activeSchool.name} size={38} />
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
                <option key={s.id} value={s.id} className="text-ink">{s.name}</option>
              ))}
            </select>
            <ChevronsUpDown className="pointer-events-none absolute right-0 top-0.5 h-4 w-4 text-white/60" aria-hidden />
          </label>
        ) : (
          <p className="truncate text-sm font-semibold text-white">{activeSchool.name}</p>
        )}
        <p className="truncate text-xs text-white/65">{currentTerm ? `${currentTerm.name} · ${currentTerm.session_name}` : activeSchool.motto ?? "No current term set"}</p>
      </div>
    </div>
  );
}

function SidebarPanel({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col rounded-[1.75rem] bg-brand pt-5 text-white">
      <Link to="/" onClick={onNavigate} className="mb-4 flex items-center gap-2.5 px-5">
        <WepluzMark size={34} />
        <span className="text-lg font-semibold tracking-tight">Wepluz</span>
      </Link>
      <SchoolSwitcher />
      <NavList onNavigate={onNavigate} />
      <p className="px-6 pb-5 pt-2 text-[11px] text-white/45">Powered by MANDEXA</p>
    </div>
  );
}

/** Jump to any page you can open; staff can also search students by name. */
function CommandSearch() {
  const { can, isPlatformAdmin, activeSchool } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const pages = useMemo(() => navFor(can, isPlatformAdmin, Boolean(activeSchool)).flatMap((s) => s.items).filter((i) => !i.comingIn), [can, isPlatformAdmin, activeSchool]);
  const results = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return [];
    const list: { label: string; hint: string; to: string; icon?: NavItem["icon"] }[] = pages.filter((p) => p.label.toLowerCase().includes(n)).map((p) => ({ label: p.label, hint: "Page", to: p.to, icon: p.icon }));
    if (activeSchool && can(STAFF_ROLES)) list.push({ label: `Search students for "${q.trim()}"`, hint: "Students", to: `/students?q=${encodeURIComponent(q.trim())}` });
    return list.slice(0, 7);
  }, [q, pages, can, activeSchool]);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function go(to: string) {
    navigate(to);
    setQ("");
    setOpen(false);
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") setIndex((i) => Math.min(i + 1, results.length - 1));
    else if (e.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
    else if (e.key === "Enter" && results[index]) go(results[index].to);
    else if (e.key === "Escape") setOpen(false);
    else return;
    e.preventDefault();
  }

  return (
    <div ref={box} className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <input
        type="search"
        aria-label="Search pages and students"
        placeholder="Search a page or a student"
        className="w-full rounded-2xl border border-transparent bg-surface py-3 pl-11 pr-4 text-sm placeholder:text-slate-400 focus:border-brand/30 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand/10"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-slate-100 bg-white p-1.5 shadow-xl" role="listbox">
          {results.map((r, i) => {
            const Icon = r.icon ?? Search;
            return (
              <li key={r.to} role="option" aria-selected={i === index}>
                <button onMouseEnter={() => setIndex(i)} onClick={() => go(r.to)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm ${i === index ? "bg-surface" : ""}`}>
                  <Icon className="h-4 w-4 text-brand" aria-hidden />
                  <span className="flex-1 truncate">{r.label}</span>
                  <span className="text-xs text-slate-400">{r.hint}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function UserMenu() {
  const { profile, roles, isPlatformAdmin, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const name = profile?.full_name || profile?.email || profile?.phone || "Signed in";
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  const roleText = isPlatformAdmin ? "Platform admin" : roles.map((r) => ROLE_LABELS[r]).join(" · ");
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" className="flex items-center gap-3 rounded-2xl bg-surface py-1.5 pl-1.5 pr-3 hover:bg-slate-100">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-sm font-bold text-ink" aria-hidden>{initials}</span>
        <span className="hidden text-left sm:block">
          <span className="block max-w-[10rem] truncate text-sm font-semibold">{name}</span>
          <span className="block max-w-[10rem] truncate text-[11px] text-slate-500">{roleText}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-60 rounded-2xl border border-slate-100 bg-white p-2 shadow-xl">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-slate-500">{roleText}</p>
          </div>
          <button role="menuitem" onClick={() => void signOut()} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-surface">
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { activeSchool, can } = useAuth();

  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="h-full lg:p-5">
      <div className="mx-auto flex h-full max-w-[1480px] overflow-hidden bg-white lg:rounded-[2.25rem] lg:shadow-[0_20px_60px_-20px_rgba(46,125,105,0.25)]">
        <aside className="hidden w-[17rem] shrink-0 p-3 lg:block">
          <SidebarPanel />
        </aside>

        {open && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] p-2">
              <button onClick={() => setOpen(false)} className="absolute right-4 top-4 z-10 rounded-full p-2 text-white/80 hover:bg-white/10" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
              <SidebarPanel onNavigate={() => setOpen(false)} />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 px-4 pb-2 pt-4 lg:px-6 lg:pt-6">
            <button onClick={() => setOpen(true)} className="rounded-2xl bg-surface p-2.5 text-slate-600 lg:hidden" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden flex-1 md:block">
              <CommandSearch />
            </div>
            <p className="min-w-0 flex-1 truncate font-semibold md:hidden">{activeSchool?.name ?? "Wepluz"}</p>
            {activeSchool && can(ADMIN_ROLES) && (
              <Link to="/settings/school" className="hidden rounded-2xl bg-surface p-3 text-slate-600 hover:text-brand sm:block" aria-label="School settings" title="School settings">
                <Settings className="h-[18px] w-[18px]" />
              </Link>
            )}
            <UserMenu />
          </header>
          {isDemoMode && (
            <div className="mx-4 mt-2 rounded-2xl bg-accent/25 px-4 py-2 text-center text-xs font-medium text-[#6B4F00] lg:mx-6" role="note">
              Demo mode: sample data only. Do not enter real student or parent information.
            </div>
          )}
          <main className="relative flex-1 overflow-y-auto">
            <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
