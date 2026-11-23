import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  console.warn("Supabase is not configured. Copy .env.example to .env.local and fill in your project URL and anon key.");
}

// The anon key is public by design; data is protected by row-level security.
export const supabase = createClient(url ?? "http://localhost:54321", anonKey ?? "missing-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const SCHOOL_ASSETS_BUCKET = "school-assets";

export function publicAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from(SCHOOL_ASSETS_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Turn Supabase / network errors into messages a school user can act on.
export function friendlyError(error: unknown): string {
  const msg = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : String(error);
  const lower = msg.toLowerCase();
  if (lower.includes("invalid login credentials")) return "Wrong email or password.";
  if (lower.includes("email not confirmed")) return "Please confirm your email address first. Check your inbox.";
  if (lower.includes("token has expired") || lower.includes("otp_expired") || lower.includes("invalid otp")) return "That code is wrong or has expired. Request a new one.";
  if (lower.includes("signups not allowed") || lower.includes("user not found")) return "This number is not registered with the school. Please contact the school office.";
  if (lower.includes("rate limit") || lower.includes("too many")) return "Too many attempts. Please wait a minute and try again.";
  if (lower.includes("failed to fetch") || lower.includes("network")) return "Cannot reach the server. Check your internet connection.";
  if (lower.includes("row-level security") || lower.includes("permission denied")) return "You do not have permission to do that.";
  return msg || "Something went wrong. Please try again.";
}
