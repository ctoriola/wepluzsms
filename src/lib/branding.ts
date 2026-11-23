const DEFAULT_PRIMARY = "#14213D";
const DEFAULT_ACCENT = "#0F766E";

function hexToRgbTriplet(hex: string, fallback: string): string {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback;
  const n = parseInt(clean.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// Apply a school's colours to the whole app via CSS variables used by Tailwind.
export function applyBranding(primary?: string | null, accent?: string | null) {
  const root = document.documentElement;
  root.style.setProperty("--brand", hexToRgbTriplet(primary ?? DEFAULT_PRIMARY, DEFAULT_PRIMARY));
  root.style.setProperty("--accent", hexToRgbTriplet(accent ?? DEFAULT_ACCENT, DEFAULT_ACCENT));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", primary ?? DEFAULT_PRIMARY);
}

// School slug from subdomain (greenfield.app.example.com) or ?school=greenfield
export function schoolSlugFromLocation(): string | null {
  const param = new URLSearchParams(window.location.search).get("school");
  if (param) return param.toLowerCase();
  const root = import.meta.env.VITE_APP_ROOT_DOMAIN as string | undefined;
  const host = window.location.hostname;
  if (root && host.endsWith(`.${root}`)) {
    const sub = host.slice(0, -(root.length + 1));
    if (sub && sub !== "www" && !sub.includes(".")) return sub;
  }
  return null;
}
