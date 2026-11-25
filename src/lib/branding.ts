const DEFAULT_SCHOOL = "#2E7D69";

function hexToRgbTriplet(hex: string, fallback: string): string {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback;
  const n = parseInt(clean.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// The app wears the Wepluz design system; a school's own colour shows on its
// logo badge and login page (and later on report cards).
export function applyBranding(primary?: string | null, _accent?: string | null) {
  document.documentElement.style.setProperty("--school", hexToRgbTriplet(primary ?? DEFAULT_SCHOOL, DEFAULT_SCHOOL));
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
