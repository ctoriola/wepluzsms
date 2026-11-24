// Turn an uploaded spreadsheet (.xlsx or .csv) into student import rows.

export type ImportRow = {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  gender?: string;
  dateOfBirth?: string;
  className?: string;
  arm?: string;
  admissionNo?: string;
  admissionDate?: string;
  guardianName?: string;
  guardianPhone?: string;
  guardianEmail?: string;
  relationship?: string;
};

export const TEMPLATE_HEADERS = [
  "First name", "Middle name", "Surname", "Gender", "Date of birth", "Class", "Arm",
  "Admission number", "Admission date", "Guardian name", "Guardian phone", "Guardian email", "Relationship",
];

const EXAMPLE = ["Amina", "", "Bello", "Female", "12/04/2015", "Primary 6", "A", "", "", "Alhaji Musa Bello", "08031234567", "", "Father"];

// Accept the many ways schools label their columns.
const ALIASES: Record<keyof ImportRow, string[]> = {
  firstName: ["first name", "firstname", "first", "given name", "forename"],
  middleName: ["middle name", "middlename", "other name", "other names", "middle"],
  lastName: ["surname", "last name", "lastname", "family name"],
  gender: ["gender", "sex"],
  dateOfBirth: ["date of birth", "dob", "birth date", "birthday"],
  className: ["class", "class name", "level", "class level"],
  arm: ["arm", "class arm", "stream", "section"],
  admissionNo: ["admission number", "admission no", "admission no.", "adm no", "reg no", "registration number"],
  admissionDate: ["admission date", "date of admission", "date admitted"],
  guardianName: ["guardian name", "parent name", "parent/guardian name", "guardian", "parent"],
  guardianPhone: ["guardian phone", "parent phone", "phone", "phone number", "guardian phone number", "parent phone number"],
  guardianEmail: ["guardian email", "parent email", "email"],
  relationship: ["relationship", "relation"],
};

const norm = (h: string) => h.toLowerCase().replace(/[_*]/g, " ").replace(/\s+/g, " ").trim();

export function mapHeaders(headers: string[]): { map: (keyof ImportRow | null)[]; missing: string[] } {
  const map = headers.map((h) => {
    const n = norm(h);
    return (Object.keys(ALIASES) as (keyof ImportRow)[]).find((k) => ALIASES[k].includes(n)) ?? null;
  });
  const required: [keyof ImportRow, string][] = [["firstName", "First name"], ["lastName", "Surname"], ["gender", "Gender"], ["className", "Class"]];
  return { map, missing: required.filter(([k]) => !map.includes(k)).map(([, label]) => label) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Cell value from Excel/CSV to text; dates become DD/MM/YYYY; numeric phones get their leading 0 back. */
export function cellText(v: unknown, key: keyof ImportRow | null): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
  if (typeof v === "number" && key === "guardianPhone") {
    const s = String(Math.round(v));
    return s.length === 10 ? `0${s}` : s;
  }
  return String(v).trim();
}

export function rowsFromTable(table: unknown[][]): { rows: ImportRow[]; missing: string[] } {
  const headerIndex = table.findIndex((r) => r.some((c) => String(c ?? "").trim()));
  if (headerIndex < 0) return { rows: [], missing: ["a header row"] };
  const { map, missing } = mapHeaders(table[headerIndex].map((c) => String(c ?? "")));
  const rows = table
    .slice(headerIndex + 1)
    .filter((r) => r.some((c) => String(c ?? "").trim()))
    .map((r) => {
      const row: ImportRow = {};
      map.forEach((key, i) => {
        if (key) row[key] = cellText(r[i], key);
      });
      return row;
    });
  return { rows, missing };
}

/** Minimal CSV parser (handles quotes, commas and newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

export async function readSpreadsheet(file: File): Promise<{ rows: ImportRow[]; missing: string[] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return rowsFromTable(parseCsv(await file.text()));
  if (name.endsWith(".xlsx")) {
    const { default: readXlsxFile } = await import("read-excel-file");
    return rowsFromTable((await readXlsxFile(file)) as unknown[][]);
  }
  throw new Error("Upload an Excel (.xlsx) or CSV (.csv) file. Old .xls files: open in Excel and 'Save As' .xlsx first.");
}

export function templateCsv(): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return `﻿${[TEMPLATE_HEADERS, EXAMPLE].map((r) => r.map(q).join(",")).join("\r\n")}\r\n`;
}
