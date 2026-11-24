import {
  BookOpen,
  Building2,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Globe,
  Layers,
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
  /** Only MANDEXA platform admins see this item. */
  platformOnly?: boolean;
  /** Needs a school to be open. */
  needsSchool?: boolean;
};

export type NavSection = { title?: string; items: NavItem[] };

const TEACHING: Role[] = [...ADMIN_ROLES, "teacher"];

export const NAV: NavSection[] = [
  { title: "Platform", items: [{ label: "Schools", to: "/platform/schools", icon: Globe, roles: [], platformOnly: true }] },
  { items: [{ label: "Dashboard", to: "/", icon: LayoutDashboard, roles: [...ROLES], needsSchool: true }] },
  {
    title: "Academics",
    items: [
      { label: "Students", to: "/students", icon: Users, roles: STAFF_ROLES, needsSchool: true },
      { label: "Attendance", to: "/attendance", icon: CalendarCheck, roles: TEACHING, comingIn: "WS3" },
      { label: "Results", to: "/results", icon: GraduationCap, roles: TEACHING, comingIn: "WS4" },
    ],
  },
  {
    title: "School setup",
    items: [
      { label: "Sessions & terms", to: "/academics/calendar", icon: CalendarDays, roles: ADMIN_ROLES },
      { label: "Classes & arms", to: "/academics/classes", icon: Layers, roles: ADMIN_ROLES },
      { label: "Subjects", to: "/academics/subjects", icon: BookOpen, roles: ADMIN_ROLES },
      { label: "Teacher assignments", to: "/academics/teachers", icon: ClipboardList, roles: ADMIN_ROLES },
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
      { label: "Children", to: "/parent/children", icon: HeartHandshake, roles: ["parent"] },
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

export function navFor(can: (roles: Role[]) => boolean, isPlatformAdmin: boolean, hasSchool: boolean): NavSection[] {
  return NAV.map((section) => ({
    ...section,
    items: section.items.filter((i) => (i.platformOnly ? isPlatformAdmin : hasSchool && can(i.roles))),
  })).filter((s) => s.items.length > 0);
}
