import { AlertTriangle } from "lucide-react";
import type { ClassLevel } from "@/lib/academics";
import { initials, type Student } from "@/lib/students";

export type ArmOption = { id: string; label: string; levelId: string; levelName: string; order: number; teacherIds: string[]; capacity: number | null };

export function armOptions(levels: ClassLevel[]): ArmOption[] {
  return levels.flatMap((l) =>
    l.class_arms.map((a) => ({ id: a.id, label: `${l.name} ${a.name}`, levelId: l.id, levelName: l.name, order: l.order_index, teacherIds: a.teacher_ids, capacity: a.capacity })),
  );
}

export function StudentAvatar({ student, photo, size = 40 }: { student: Pick<Student, "firstName" | "lastName" | "gender">; photo?: string | null; size?: number }) {
  if (photo) return <img src={photo} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${student.gender === "female" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {initials(student)}
    </div>
  );
}

export function MedicalFlag({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700" title="Medical alert: check with the school office">
      <AlertTriangle className="h-3 w-3" aria-hidden /> {compact ? "" : "Medical alert"}
      {compact && <span className="sr-only">Medical alert</span>}
    </span>
  );
}

export const STATUS_TONE = { active: "green", withdrawn: "amber", graduated: "brand" } as const;

export function ArmSelect({ id, value, onChange, arms, placeholder = "Choose a class" }: { id: string; value: string; onChange: (v: string) => void; arms: ArmOption[]; placeholder?: string }) {
  const levels = [...new Map(arms.map((a) => [a.levelId, a])).values()];
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {levels.map((l) => (
        <optgroup key={l.levelId} label={l.levelName}>
          {arms.filter((a) => a.levelId === l.levelId).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </optgroup>
      ))}
    </select>
  );
}
