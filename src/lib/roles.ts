export const ROLES = ["proprietor", "principal", "school_admin", "bursar", "teacher", "parent"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  proprietor: "Proprietor",
  principal: "Principal",
  school_admin: "School Admin",
  bursar: "Bursar",
  teacher: "Teacher",
  parent: "Parent",
};

export const ADMIN_ROLES: Role[] = ["proprietor", "principal", "school_admin"];
export const STAFF_ROLES: Role[] = ["proprietor", "principal", "school_admin", "bursar", "teacher"];
export const FINANCE_ROLES: Role[] = ["proprietor", "principal", "school_admin", "bursar"];

export const hasAny = (mine: Role[], wanted: Role[]) => mine.some((r) => wanted.includes(r));

// UI mirror of public.can_manage_role(). The database enforces the real rule.
export function manageableRoles(mine: Role[], isPlatformAdmin = false): Role[] {
  if (isPlatformAdmin || mine.includes("proprietor")) return [...ROLES];
  if (hasAny(mine, ["principal", "school_admin"])) return ["school_admin", "bursar", "teacher", "parent"];
  return [];
}
