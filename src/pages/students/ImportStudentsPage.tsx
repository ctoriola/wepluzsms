import { ArrowLeft, CheckCircle2, Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Button, PageHeader } from "@/components/ui";
import { api, friendlyError } from "@/lib/api";
import { readSpreadsheet, templateCsv, type ImportRow } from "@/lib/spreadsheet";

type Result = { ok: boolean; valid: number; total: number; errors: { row: number; messages: string[] }[]; saved: number; guardiansCreated?: number; guardiansLinked?: number };

const CHUNK = 300;

export function ImportStudentsPage() {
  const { activeSchool } = useAuth();
  const sid = activeSchool!.id;
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [check, setCheck] = useState<Result | null>(null);
  const [saved, setSaved] = useState<{ students: number; guardiansCreated: number; guardiansLinked: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reading" | "checking" | "saving" | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([templateCsv()], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "wepluz-students-template.csv" });
    a.click();
    URL.revokeObjectURL(url);
  }

  async function choose(f: File) {
    setError(null);
    setCheck(null);
    setSaved(null);
    setFile(f);
    setBusy("reading");
    try {
      const { rows, missing } = await readSpreadsheet(f);
      if (missing.length) throw new Error(`The file is missing these columns: ${missing.join(", ")}. Download the template to see the expected headings.`);
      if (!rows.length) throw new Error("The file has no student rows under the header.");
      setRows(rows);
      setBusy("checking");
      // Check everything first (nothing is saved).
      const results: Result[] = [];
      for (let i = 0; i < rows.length; i += CHUNK) {
        const r = await api<Result>("students.import", { schoolId: sid, dryRun: true, rows: rows.slice(i, i + CHUNK) });
        results.push({ ...r, errors: r.errors.map((e) => ({ ...e, row: e.row ? e.row + i : 0 })) });
      }
      setCheck({ ok: results.every((r) => r.ok), valid: results.reduce((n, r) => n + r.valid, 0), total: rows.length, errors: results.flatMap((r) => r.errors), saved: 0 });
    } catch (err) {
      setRows(null);
      setError(friendlyError(err));
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  async function save() {
    if (!rows) return;
    setBusy("saving");
    setError(null);
    const total = { students: 0, guardiansCreated: 0, guardiansLinked: 0 };
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const r = await api<Result>("students.import", { schoolId: sid, dryRun: false, rows: rows.slice(i, i + CHUNK) });
        if (!r.ok) throw new Error(`Rows ${i + 2}-${i + CHUNK + 1} could not be saved. Check the file again.`);
        total.students += r.saved;
        total.guardiansCreated += r.guardiansCreated ?? 0;
        total.guardiansLinked += r.guardiansLinked ?? 0;
      }
      setSaved(total);
      setRows(null);
      setCheck(null);
    } catch (err) {
      setError(`${friendlyError(err)}${total.students ? ` (${total.students} students were already saved; remove them from the file before retrying.)` : ""}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Link to="/students" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Students</Link>
      <PageHeader title="Import students" description="Bring in your existing student list from Excel. Nothing is saved until every row is correct." />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {saved && (
        <div className="mb-4">
          <Alert tone="success">
            Imported {saved.students} students. {saved.guardiansCreated} new guardians added
            {saved.guardiansLinked ? `, ${saved.guardiansLinked} linked to an existing guardian with the same phone (siblings)` : ""}. <Link to="/students" className="font-semibold underline">View students</Link>
          </Alert>
        </div>
      )}

      <ol className="space-y-4">
        <li className="card p-5">
          <h2 className="font-semibold">1. Get the template</h2>
          <p className="mt-1 text-sm text-slate-600">
            One row per student. Required: First name, Surname, Gender, Class (exactly as in Classes & arms, e.g. "JSS 1") and Arm if the class has more than one.
            Admission numbers are generated if left blank. Dates can be DD/MM/YYYY.
          </p>
          <Button variant="secondary" className="mt-3" onClick={downloadTemplate}><Download className="h-4 w-4" aria-hidden /> Download template</Button>
        </li>
        <li className="card p-5">
          <h2 className="font-semibold">2. Upload your file</h2>
          <p className="mt-1 text-sm text-slate-600">Excel (.xlsx) or CSV. Your own column names usually work too (e.g. "Sex", "Parent phone", "Adm No").</p>
          <input ref={input} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && void choose(e.target.files[0])} />
          <Button className="mt-3" loading={busy === "reading" || busy === "checking"} onClick={() => input.current?.click()}>
            <Upload className="h-4 w-4" aria-hidden /> {busy === "checking" ? "Checking..." : file ? "Choose another file" : "Choose file"}
          </Button>
          {file && <p className="mt-2 text-xs text-slate-500">{file.name}</p>}
        </li>
        {check && (
          <li className="card p-5">
            <h2 className="font-semibold">3. Check and import</h2>
            {check.ok ? (
              <>
                <p className="mt-2 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden /> All {check.total} rows are correct.</p>
                <Button className="mt-3" loading={busy === "saving"} onClick={() => void save()}>Import {check.total} students</Button>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-slate-700">
                  {check.valid} of {check.total} rows are fine. Fix the rows below in your spreadsheet, save, and upload it again.
                </p>
                <div className="mt-3 max-h-96 overflow-auto rounded-lg border border-red-200">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-red-50 text-left text-red-900">
                      <tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Problem</th></tr>
                    </thead>
                    <tbody className="divide-y divide-red-100">
                      {check.errors.map((e, i) => (
                        <tr key={i}>
                          <td className="whitespace-nowrap px-3 py-2 align-top font-medium">{e.row || "All"}</td>
                          <td className="px-3 py-2">{e.messages.map((m, j) => <p key={j}>{m}</p>)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </li>
        )}
      </ol>
    </>
  );
}
