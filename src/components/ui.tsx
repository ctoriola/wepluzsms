import { Loader2, X } from "lucide-react";
import React, { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white shadow-sm shadow-brand/20 hover:bg-brand/90 focus-visible:ring-brand/30",
  secondary: "border border-slate-200 bg-white text-ink hover:border-brand/40 hover:text-brand focus-visible:ring-brand/20",
  ghost: "text-slate-600 hover:bg-white hover:text-ink focus-visible:ring-slate-300",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-300",
};

export function Button({
  variant = "primary",
  loading = false,
  className = "",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-transparent bg-[#FBE7E3] text-[#9B3A27]",
    success: "border-transparent bg-[#E2F3EA] text-[#1F6B4A]",
    info: "border-transparent bg-[#E6F1F6] text-[#24566E]",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-2xl border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "brand" | "amber" | "red" | "green" }) {
  const styles = {
    slate: "bg-white text-slate-600",
    brand: "bg-brand/10 text-brand",
    amber: "bg-[#FFF1C7] text-[#7A5600]",
    red: "bg-[#FBE2DC] text-[#A23B26]",
    green: "bg-[#DCF0E2] text-[#22663F]",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${styles}`}>{children}</span>;
}

export function FullPageSpinner({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center gap-3 text-slate-500" role="status">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function SchoolLogo({ url, name, size = 40 }: { url: string | null; name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return url ? (
    <img src={url} alt={`${name} logo`} width={size} height={size} className="shrink-0 rounded-2xl bg-white object-contain p-1" style={{ width: size, height: size }} />
  ) : (
    <div className="flex shrink-0 items-center justify-center rounded-2xl bg-school font-bold text-white" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {initials || "S"}
    </div>
  );
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-full bg-surface p-2 text-slate-500 hover:text-ink" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="mt-2 max-w-md text-sm text-slate-600">{children}</div>}
    </div>
  );
}

/** Teal circle with a white icon, used beside card titles (Wepluz design system). */
export function IconChip({ icon: Icon, tone = "brand", size = 36 }: { icon: React.ComponentType<{ className?: string }>; tone?: "brand" | "accent"; size?: number }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full ${tone === "brand" ? "bg-brand text-white" : "bg-accent text-ink"}`} style={{ width: size, height: size }} aria-hidden>
      <Icon className="h-[45%] w-[45%]" />
    </span>
  );
}

/** Card heading: icon chip + title, optional right-side action. */
export function CardTitle({ icon, title, action }: { icon?: React.ComponentType<{ className?: string }>; title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      {icon && <IconChip icon={icon} />}
      <h2 className="flex-1 text-lg font-semibold">{title}</h2>
      {action}
    </div>
  );
}
