// Demo mode: one-click sign-in with the seeded demo accounts.
// Turn on with VITE_DEMO_MODE=true. NEVER enable on a production deployment:
// the demo passwords are public.
export const isDemoMode = import.meta.env.VITE_DEMO_MODE === "true";

export const DEMO_PASSWORD = "Password123!";

export const DEMO_ACCOUNTS = [
  { label: "Proprietor", email: "proprietor@demo.test", who: "Adaeze Okafor" },
  { label: "Principal", email: "principal@demo.test", who: "Tunde Bakare" },
  { label: "School admin", email: "admin@demo.test", who: "Ngozi Eze" },
  { label: "Bursar", email: "bursar@demo.test", who: "Ibrahim Musa" },
  { label: "Teacher", email: "teacher1@demo.test", who: "Funmi Adeyemi" },
  { label: "Teacher + parent", email: "teacher2@demo.test", who: "Chinedu Obi" },
  { label: "Parent", email: "parent1@demo.test", who: "Mrs Bisi Lawal" },
  { label: "Other school", email: "proprietor@greenfield.test", who: "Greenfield College proprietor" },
  { label: "Platform admin", email: "admin@mandexa.test", who: "MANDEXA (all schools)" },
] as const;
