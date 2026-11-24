import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Alert, Badge, EmptyState, FullPageSpinner, PageHeader } from "@/components/ui";
import { loadLevels } from "@/lib/academics";
import { useAsync } from "@/lib/data";
import { ageOn, fullName, loadMyChildren, loadPhoto } from "@/lib/students";
import { armOptions, MedicalFlag, StudentAvatar } from "../students/common";

export function ChildrenPage() {
  const { activeSchool, profile } = useAuth();
  const sid = activeSchool!.id;
  const data = useAsync(async () => {
    const [children, levels] = await Promise.all([loadMyChildren(sid, profile!.id), loadLevels(sid)]);
    const photos = await Promise.all(children.map((c) => (c.hasPhoto ? loadPhoto(sid, c.id) : Promise.resolve(null))));
    return { children, photos, arms: new Map(armOptions(levels).map((a) => [a.id, a.label])) };
  }, [sid, profile?.id]);

  if (data.loading && !data.data) return <FullPageSpinner />;
  return (
    <>
      <PageHeader title="My children" description={activeSchool!.name} />
      {data.error && <Alert>{data.error}</Alert>}
      {data.data?.children.length === 0 && (
        <EmptyState title="No children linked yet">If your child attends this school, ask the school office to link them to your account.</EmptyState>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {data.data?.children.map((c, i) => (
          <Link key={c.id} to={`/students/${c.id}`} className="card flex items-center gap-4 p-5 hover:border-brand/40">
            <StudentAvatar student={c} photo={data.data!.photos[i]} size={56} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{fullName(c)}</p>
              <p className="text-sm text-slate-500">{data.data!.arms.get(c.currentArmId ?? "") ?? "No class this session"}</p>
              <p className="text-xs text-slate-400">{c.admissionNo}{c.dateOfBirth ? ` · ${ageOn(c.dateOfBirth)} yrs` : ""}</p>
            </div>
            {c.status !== "active" && <Badge tone="amber">{c.status}</Badge>}
            {c.hasMedicalAlert && <MedicalFlag compact />}
          </Link>
        ))}
      </div>
    </>
  );
}
