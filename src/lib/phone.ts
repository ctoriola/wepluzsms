// Normalise a phone number to E.164 (+234...). Mirrors public.normalize_phone (SQL)
// and supabase/functions/_shared/phone.ts. Returns null if not a plausible number.
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (!digits) return null;
  let e164: string;
  if (trimmed.startsWith("+")) e164 = `+${digits}`;
  else if (digits.startsWith("234")) e164 = `+${digits}`;
  else if (digits.startsWith("0") && digits.length === 11) e164 = `+234${digits.slice(1)}`;
  else e164 = `+${digits}`;
  return /^\+[1-9][0-9]{7,14}$/.test(e164) ? e164 : null;
}

// +2348031234567 -> 0803 123 4567 (Nigerian numbers); others unchanged.
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  if (e164.startsWith("+234") && e164.length === 14) {
    const local = `0${e164.slice(4)}`;
    return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  }
  return e164;
}
