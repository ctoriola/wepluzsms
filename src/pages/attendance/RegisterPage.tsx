import { ArrowLeft, CheckCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Button, FullPageSpinner } from "@/components/ui";
import { loadLevels } from "@/lib/academics";
import { friendlyError } from "@/lib/api";
import { loadRegister, MARK_LABEL, MARKS, saveRegister, type Mark } from "@/lib/attendance";
import { formatDate, useAsync } from "@/lib/data";
import { fullName, loadStudentsInArms } from "@/lib/students";
import { armOptions, MedicalFlag, StudentAvatar } from "../students/common";

const MARK_HINT: Record<Mark, string> = {
  present: "in school",
  absent: "did not come",
  late: "came late (counts as attending)",
  excused: "absent with permission (not counted against them)",
};

const STYLE: Record<Mark, string> = {
  present: "bg-emerald-600 text-white border-emerald-600",
  absent: "bg-red-600 text-white border-red-600",
  late: "bg-amber-500 text-white border-amber-500",
  excused: "bg-slate-500 text-white border-slate-500",
};

// Mobile-first register: everyone starts present; tap A / L / E for the exceptions.
export function RegisterPage() {
  const { armId, date } = useParams<{ armId: string; date: string }>();
  const { activeSchool } = useAuth();
  const sid = activeSchool!.id;
  const navigate = useNavigate();
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = useAsync(async () => {
    const [levels, students, existing] = await Promise.all([loadLevels(sid), loadStudentsInArms(sid, [armId!]), loadRegister(sid, armId!, date!)]);
    const active = students.filter((s) => s.status === "active").sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
    return { label: armOptions(levels).find((a) => a.id === armId)?.label ?? "Class", students: active, existing };
  }, [sid, armId, date]);

  useEffect(() => {
    if (!data.data) return;
    setMarks(Object.fromEntries(data.data.students.map((s) => [s.id, data.data!.existing?.marks?.[s.id] ?? "present"])));
  }, [data.data]);

  const counts = useMemo(() => Object.fromEntries(MARKS.map((m) => [m, Object.values(marks).filter((x) => x === m).length])) as Record<Mark, number>, [marks]);

  async function save() {
    if (!data.data) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveRegister({ schoolId: sid, armId: armId!, date: date!, marks, label: data.data.label });
      sessionStorage.setItem(
        "wepluz.attendanceNotice",
        result === "sent"
          ? `${data.data.label} register saved: ${counts.present} present, ${counts.absent} absent, ${counts.late} late.${counts.absent ? " Parents of absent students will be alerted once messaging is switched on." : ""}`
          : `No internet. ${data.data.label} register is saved on this phone and will be sent automatically when you are back online.`,
      );
      navigate("/attendance");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  if (data.loading && !data.data) return <FullPageSpinner />;
  if (data.error) return <Alert>{data.error}</Alert>;
  const students = data.data!.students;

  return (
    <div>
      <Link to="/attendance" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Attendance</Link>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{data.data!.label} register</h1>
          <p className="text-sm text-slate-500">{formatDate(date!, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}{data.data!.existing ? " · editing a saved register" : ""}</p>
        </div>
        <Button variant="secondary" onClick={() => setMarks(Object.fromEntries(students.map((s) => [s.id, "present"])))}>
          <CheckCheck className="h-4 w-4" aria-hidden /> All present
        </Button>
      </div>
      <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600" aria-label="Key">
        {MARKS.map((m) => (
          <li key={m} className="flex items-center gap-1.5">
            <span className={`flex h-6 w-6 items-center justify-center rounded-md border text-[11px] font-bold ${STYLE[m]}`} aria-hidden>{MARK_LABEL[m][0]}</span>
            <span><span className="font-semibold text-ink">{MARK_LABEL[m]}</span> <span className="text-slate-500">{MARK_HINT[m]}</span></span>
          </li>
        ))}
      </ul>
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {students.length === 0 ? (
        <Alert tone="info">This class has no active students yet.</Alert>
      ) : (
        <ul className="card divide-y divide-slate-100">
          {students.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
              <StudentAvatar student={s} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{fullName(s)}</p>
                {s.hasMedicalAlert && <MedicalFlag compact />}
              </div>
              <div className="flex gap-1" role="radiogroup" aria-label={`Attendance for ${fullName(s)}`}>
                {MARKS.map((m) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={marks[s.id] === m}
                    aria-label={`${MARK_LABEL[m]}: ${fullName(s)}`}
                    title={MARK_LABEL[m]}
                    onClick={() => setMarks({ ...marks, [s.id]: m })}
                    className={`h-9 w-9 rounded-lg border text-sm font-bold transition ${marks[s.id] === m ? STYLE[m] : "border-slate-200 bg-white text-slate-400 hover:border-slate-400"}`}
                  >
                    {MARK_LABEL[m][0]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="sticky bottom-3 z-30 mt-4 rounded-2xl border border-slate-100 bg-white/95 px-4 py-3 shadow-lg shadow-ink/10 backdrop-blur">
        <div className="flex items-center gap-3">
          <p className="flex-1 text-sm text-slate-600">
            <span className="font-semibold text-emerald-700">{counts.present}</span> P · <span className="font-semibold text-red-600">{counts.absent}</span> A · <span className="font-semibold text-amber-600">{counts.late}</span> L
            {counts.excused ? <> · <span className="font-semibold">{counts.excused}</span> E</> : null}
          </p>
          <Button loading={busy} disabled={!students.length} onClick={() => void save()}>Save register</Button>
        </div>
      </div>
    </div>
  );
}
