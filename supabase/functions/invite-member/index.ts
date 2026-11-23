// =============================================================================
// WS0 Task 0.19: Invite a person to a school with a role
//
// POST { school_id, role, full_name, email?, phone? }
//   * email -> Supabase sends an invite email; the link opens /set-password
//   * phone -> account created; the person logs in with phone + SMS code
//   * if the person already has an account (e.g. a teacher who is also a parent,
//     or staff of another school in the group) we simply add the new role
//
// Security: the caller's own permissions are checked in the database through
// public.can_manage_role(), the same rule the RLS policies use. Only after that
// check passes do we use the service role to create the account and membership.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { corsHeaders, json, requireEnv } from "../_shared/http.ts";
import { normalizePhone } from "../_shared/phone.ts";

const ROLES = ["proprietor", "principal", "school_admin", "bursar", "teacher", "parent"] as const;
type Role = (typeof ROLES)[number];

type InviteRequest = {
  school_id?: string;
  role?: string;
  full_name?: string;
  email?: string;
  phone?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const anonKey = requireEnv("SUPABASE_ANON_KEY");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const appUrl = requireEnv("APP_URL");

    // 1. Who is calling?
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not signed in" }, 401);
    const asCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user: caller }, error: callerError } = await asCaller.auth.getUser();
    if (callerError || !caller) return json({ error: "Not signed in" }, 401);

    // 2. Validate input.
    let body: InviteRequest;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const schoolId = body.school_id?.trim() ?? "";
    const role = body.role as Role;
    const fullName = body.full_name?.trim() ?? "";
    const email = body.email?.trim().toLowerCase() || null;
    const phone = body.phone ? normalizePhone(body.phone) : null;

    if (!UUID_RE.test(schoolId)) return json({ error: "Invalid school" }, 400);
    if (!ROLES.includes(role)) return json({ error: "Invalid role" }, 400);
    if (fullName.length < 2 || fullName.length > 200) return json({ error: "Enter the person's full name" }, 400);
    if (!email && !phone) return json({ error: "Enter an email address or a valid phone number" }, 400);
    if (email && !EMAIL_RE.test(email)) return json({ error: "Enter a valid email address" }, 400);
    if (body.phone && !phone) return json({ error: "Enter a valid phone number, e.g. 08031234567" }, 400);

    // 3. Is the caller allowed to grant this role in this school? (same rule as RLS)
    const { data: allowed, error: permError } = await asCaller.rpc("can_manage_role", {
      p_school_id: schoolId,
      p_role: role,
    });
    if (permError) throw permError;
    if (!allowed) return json({ error: "You are not allowed to give this role in this school" }, 403);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 4. Find an existing account, or create one.
    const findExisting = async (): Promise<string | null> => {
      const query = admin.from("profiles").select("id").limit(1);
      const { data, error } = email
        ? await query.eq("email", email)
        : await query.eq("phone", phone!);
      if (error) throw error;
      return data?.[0]?.id ?? null;
    };

    let userId = await findExisting();
    let created = false;

    if (!userId) {
      if (email) {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { full_name: fullName },
          redirectTo: `${appUrl.replace(/\/$/, "")}/set-password`,
        });
        if (error) {
          userId = await findExisting(); // created in parallel by someone else?
          if (!userId) throw error;
        } else {
          userId = data.user.id;
          created = true;
        }
      } else {
        const { data, error } = await admin.auth.admin.createUser({
          phone: phone!.slice(1),
          phone_confirm: true,
          user_metadata: { full_name: fullName },
        });
        if (error) {
          userId = await findExisting();
          if (!userId) throw error;
        } else {
          userId = data.user.id;
          created = true;
        }
      }
    }

    if (userId === caller.id) return json({ error: "You cannot change your own access" }, 400);

    // Fill in a missing name on an existing profile (never overwrite a name the person set).
    await admin.from("profiles").update({ full_name: fullName }).eq("id", userId).is("full_name", null);

    // 5. Grant the role (re-activates it if it was suspended).
    const { data: membership, error: memberError } = await admin
      .from("school_memberships")
      .upsert(
        { school_id: schoolId, user_id: userId, role, status: "active", invited_by: caller.id },
        { onConflict: "school_id,user_id,role" },
      )
      .select("id")
      .single();
    if (memberError) throw memberError;

    // TODO (WS6): send a WhatsApp/SMS welcome message to phone invites via n8n.
    return json({ user_id: userId, membership_id: membership.id, created });
  } catch (err) {
    console.error("invite-member failed:", err instanceof Error ? err.message : err);
    return json({ error: "Something went wrong while sending the invite. Please try again." }, 500);
  }
});
