import { CheckCircle2, Circle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { PageHeader } from "@/components/ui";
import { ADMIN_ROLES } from "@/lib/roles";
import { supabase } from "@/lib/supabase";

type Checklist = { profileComplete: boolean; logoUploaded: boolean; staffInvited: boolean; leadershipInPlace: boolean };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function SetupChecklist({ schoolId }: { schoolId: string }) {
  const [list, setList] = useState<Checklist | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [settings, members] = await Promise.all([
        supabase.from("school_settings").select("address, phone, email, logo_path").eq("school_id", schoolId).maybeSingle(),
        supabase.from("school_memberships").select("role").eq("school_id", schoolId).eq("status", "active"),
      ]);
      if (cancelled) return;
      const s = settings.data;
      const roles = (members.data ?? []).map((m) => m.role as string);
      setList({
        profileComplete: Boolean(s?.address && s?.phone && s?.email),
        logoUploaded: Boolean(s?.logo_path),
        leadershipInPlace: roles.includes("principal") || roles.includes("school_admin"),
        staffInvited: roles.filter((r) => r === "teacher" || r === "bursar").length >= 1,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  if (!list) return null;
  const items = [
    { done: list.profileComplete, label: "Add the school's address, phone and email", to: "/settings/school" },
    { done: list.logoUploaded, label: "Upload the school logo", to: "/settings/school" },
    { done: list.leadershipInPlace, label: "Invite a principal or school admin", to: "/settings/staff" },
    { done: list.staffInvited, label: "Invite your bursar and teachers", to: "/settings/staff" },
  ];
  const doneCount = items.filter((i) => i.done).length;

  return (
    <section className="card p-5" aria-labelledby="setup-title">
      <div className="flex items-center justify-between">
        <h2 id="setup-title" className="font-semibold">Get your school ready</h2>
        <span className="text-sm text-slate-500">{doneCount} of {items.length} done</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(doneCount / items.length) * 100}%` }} />
      </div>
      <ul className="mt-4 divide-y divide-slate-100">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-3 py-2.5">
            {item.done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-accent" aria-label="Done" /> : <Circle className="h-5 w-5 shrink-0 text-slate-300" aria-label="Not done" />}
            <span className={`flex-1 text-sm ${item.done ? "text-slate-500 line-through" : "text-slate-800"}`}>{item.label}</span>
            {!item.done && (
              <Link to={item.to} className="text-sm font-medium text-brand hover:underline">
                Start
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DashboardPage() {
  const { profile, activeSchool, can } = useAuth();
  const firstName = profile?.full_name?.split(" ")[0];

  return (
    <>
      <PageHeader title={`${greeting()}${firstName ? `, ${firstName}` : ""}`} description={activeSchool?.name} />
      <div className="grid gap-6 lg:grid-cols-2">
        {activeSchool && can(ADMIN_ROLES) && <SetupChecklist schoolId={activeSchool.id} />}
        <section className="card p-5">
          <h2 className="font-semibold">What's coming next</h2>
          <p className="mt-2 text-sm text-slate-600">
            Classes and subjects, student records, attendance, results and fees are being added step by step. Menu items marked
            <span className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">Soon</span>
            will switch on as each one is ready.
          </p>
        </section>
      </div>
    </>
  );
}
