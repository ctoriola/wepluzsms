// Normalise a phone number to E.164 (+234...). Mirrors public.normalize_phone in SQL
// and src/lib/phone.ts in the web app. Returns null if the input is not a plausible number.
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
