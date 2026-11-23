import {
  BookOpen,
  Building2,
  CalendarCheck,
  GraduationCap,
  HeartHandshake,
  LayoutDashboard,
  MessageSquare,
  Receipt,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { ADMIN_ROLES, FINANCE_ROLES, ROLES, STAFF_ROLES, type Role } from "@/lib/roles";

export type NavItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  roles: Role[];
  /** Workstream that builds this page. Items without one are live now. */
  comingIn?: string;
};

export type NavSection = { title?: string; items: NavItem[] };

const TEACHING: Role[] = [...ADMIN_ROLES, "teacher"];

export const NAV: NavSection[] = [
  { items: [{ label: "Dashboard", to: "/", icon: LayoutDashboard, roles: [...ROLES] }] },
  {
    title: "Academics",
    items: [
      { label: "Students", to: "/students", icon: Users, roles: STAFF_ROLES, comingIn: "WS2" },
      { label: "Classes & subjects", to: "/classes", icon: BookOpen, roles: ADMIN_ROLES, comingIn: "WS1" },
      { label: "Attendance", to: "/attendance", icon: CalendarCheck, roles: TEACHING, comingIn: "WS3" },
      { label: "Results", to: "/results", icon: GraduationCap, roles: TEACHING, comingIn: "WS4" },
    ],
  },
  {
    title: "Finance",
    items: [{ label: "Fees & payments", to: "/fees", icon: Wallet, roles: FINANCE_ROLES, comingIn: "WS5" }],
  },
  {
    title: "Communication",
    items: [{ label: "Messages", to: "/messages", icon: MessageSquare, roles: [...ADMIN_ROLES, "bursar"], comingIn: "WS6" }],
  },
  {
    title: "My children",
    items: [
      { label: "Children", to: "/parent/children", icon: HeartHandshake, roles: ["parent"], comingIn: "WS7" },
      { label: "Fees & receipts", to: "/parent/fees", icon: Receipt, roles: ["parent"], comingIn: "WS7" },
    ],
  },
  {
    title: "Settings",
    items: [
      { label: "School profile", to: "/settings/school", icon: Building2, roles: ADMIN_ROLES },
      { label: "Staff & access", to: "/settings/staff", icon: UserCog, roles: ADMIN_ROLES },
    ],
  },
];

export function navFor(can: (roles: Role[]) => boolean): NavSection[] {
  return NAV.map((section) => ({ ...section, items: section.items.filter((i) => can(i.roles)) })).filter((s) => s.items.length > 0);
}
