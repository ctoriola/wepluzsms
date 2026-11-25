// Server actions: setup, permissions, tenancy, school rules, audit and SMS login.
// Runs against the real Firestore + Auth emulators.
import { getFirestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminApp } from "../../server/core.js";
import { dispatch } from "../../server/rpc.js";
import { ACADEMY, call, GREENFIELD, installDemo, P, rejects, resetEmulators, sentSms } from "./helpers.js";

const db = () => getFirestore(adminApp());
const school = (sid: string) => db().collection("schools").doc(sid);
const find = async (sid: string, coll: string, field: string, value: unknown) => {
  const snap = await school(sid).collection(coll).where(field, "==", value).get();
  return snap.docs[0];
};
const levelId = async (name: string, sid = ACADEMY) => (await find(sid, "classLevels", "name", name)).id;
const subjectId = async (name: string, sid = ACADEMY) => (await find(sid, "subjects", "name", name)).id;
const armId = async (level: string, arm: string) => {
  const lid = await levelId(level);
  const snap = await school(ACADEMY).collection("classArms").where("levelId", "==", lid).get();
  return snap.docs.find((d) => d.data().name === arm)!.id;
};

describe("setup", () => {
  beforeAll(resetEmulators);
  it("reports not installed, refuses a wrong token, installs once", async () => {
    expect((await call(null, "setup.status")).installed).toBe(false);
    await rejects(call(null, "setup.install", { mode: "demo", setupToken: "wrong" }), 403, "not correct");
    await call(null, "setup.install", { mode: "demo", setupToken: "test-setup-token" });
    expect(await call(null, "setup.status")).toMatchObject({ installed: true, mode: "demo" });
    await rejects(call(null, "setup.install", { mode: "demo", setupToken: "test-setup-token" }), 409, "already installed");
  });
  it("production install creates a platform admin who can create schools", async () => {
    await resetEmulators();
    await call(null, "setup.install", { mode: "production", setupToken: "test-setup-token", fullName: "Blessing E", email: "owner@mandexa.test", password: "a-long-password-1" });
    const res = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=k", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@mandexa.test", password: "a-long-password-1", returnSecureToken: true }),
    });
    const { idToken } = (await res.json()) as { idToken: string };
    const out = (await dispatch("schools.create", { name: "Pilot School", slug: "pilot", shortCode: "PLT" }, `Bearer ${idToken}`)) as { id: string };
    expect((await school(out.id).get()).data()?.name).toBe("Pilot School");
    await expect(dispatch("schools.create", { name: "Copy", slug: "pilot", shortCode: "CPY" }, `Bearer ${idToken}`)).rejects.toMatchObject({ status: 409 });
  });
});

describe("with demo data", () => {
  beforeAll(installDemo);

  describe("seed", () => {
    it("loads the demo structure", async () => {
      const levels = await school(ACADEMY).collection("classLevels").get();
      expect(levels.size).toBe(12);
      expect((await school(ACADEMY).get()).data()?.currentTermId).toBe("s2026-t1");
      expect((await school(ACADEMY).collection("assignments").get()).size).toBe(6);
      expect((await school(ACADEMY).collection("subjects").get()).size).toBeGreaterThan(15);
    });
  });

  describe("permissions and tenancy", () => {
    it("requires sign-in", async () => {
      await rejects(call(null, "levels.create", { schoolId: ACADEMY, name: "JSS 4", section: "junior_secondary" }), 401);
    });
    it("teacher cannot change the structure", async () => {
      await rejects(call(P.teacher, "levels.create", { schoolId: ACADEMY, name: "JSS 4", section: "junior_secondary" }), 403);
      await rejects(call(P.teacher, "calendar.setCurrentTerm", { schoolId: ACADEMY, termId: "s2026-t2" }), 403);
      await rejects(call(P.teacher, "template.apply", { schoolId: ACADEMY, sections: ["nursery"] }), 403);
      await rejects(call(P.teacher, "members.invite", { schoolId: ACADEMY, role: "teacher", fullName: "X Y", email: "x@y.test" }), 403);
    });
    it("bursar and parent cannot change the structure either", async () => {
      await rejects(call(P.bursar, "subjects.create", { schoolId: ACADEMY, name: "Music", shortCode: "MUS", category: "arts" }), 403);
      await rejects(call(P.parent, "subjects.create", { schoolId: ACADEMY, name: "Music", shortCode: "MUS", category: "arts" }), 403);
    });
    it("another school's proprietor cannot touch this school", async () => {
      await rejects(call(P.gfProprietor, "levels.create", { schoolId: ACADEMY, name: "Hijack", section: "primary" }), 403);
      await rejects(call(P.gfProprietor, "calendar.setCurrentTerm", { schoolId: ACADEMY, termId: "s2026-t2" }), 403);
    });
    it("cross-school references are rejected", async () => {
      const gfLevel = await levelId("JSS 1", GREENFIELD);
      await rejects(call(P.admin, "arms.create", { schoolId: ACADEMY, levelId: gfLevel, name: "Z" }), 404, "class not found");
      await rejects(call(P.admin, "calendar.setCurrentTerm", { schoolId: ACADEMY, termId: "does-not-exist" }), 404);
    });
    it("unknown actions and bad input are rejected", async () => {
      await rejects(call(P.admin, "levels.dropDatabase", {}), 404);
      await rejects(call(P.admin, "levels.create", { schoolId: ACADEMY, name: "", section: "primary" }), 400, "class name");
      await rejects(call(P.admin, "levels.create", { schoolId: ACADEMY, name: "X", section: "university" }), 400);
    });
  });

  describe("sessions and terms", () => {
    it("validates session names, dates and duplicates", async () => {
      await rejects(call(P.admin, "sessions.create", { schoolId: ACADEMY, name: "2027-2028", startDate: "2027-09-06", endDate: "2028-07-21" }), 400, "2026/2027");
      await rejects(call(P.admin, "sessions.create", { schoolId: ACADEMY, name: "2026/2027", startDate: "2026-09-06", endDate: "2027-07-21" }), 409, "already exists");
      await rejects(call(P.admin, "sessions.create", { schoolId: ACADEMY, name: "2027/2028", startDate: "2028-01-01", endDate: "2027-07-21" }), 400, "end after");
      const { id } = await call(P.admin, "sessions.create", { schoolId: ACADEMY, name: "2027/2028", startDate: "2027-09-06", endDate: "2028-07-21" });
      await call(P.admin, "sessions.delete", { schoolId: ACADEMY, id });
    });
    it("terms must fit the session and not overlap or repeat", async () => {
      const base = { schoolId: ACADEMY, sessionId: "s2026", name: "Extra" };
      await rejects(call(P.admin, "terms.create", { ...base, termNumber: 3, startDate: "2027-05-01", endDate: "2027-06-01" }), 409, "already has term 3");
      await rejects(call(P.admin, "terms.update", { schoolId: ACADEMY, id: "s2026-t2", name: "Second Term", startDate: "2026-12-01", endDate: "2027-04-01" }), 400, "overlap");
      await rejects(call(P.admin, "terms.update", { schoolId: ACADEMY, id: "s2026-t1", name: "First Term", startDate: "2026-08-01", endDate: "2026-12-11" }), 400, "within the session");
      await rejects(call(P.admin, "terms.update", { schoolId: ACADEMY, id: "s2026-t1", name: "First Term", startDate: "2026-09-07", endDate: "2026-12-11", nextTermBegins: "2026-12-01" }), 400, "next term begins");
    });
    it("a session cannot shrink past its terms or be deleted while it has terms", async () => {
      await rejects(call(P.admin, "sessions.update", { schoolId: ACADEMY, id: "s2026", name: "2026/2027", startDate: "2026-09-07", endDate: "2027-06-01" }), 400, "falls outside");
      await rejects(call(P.admin, "sessions.delete", { schoolId: ACADEMY, id: "s2026" }), 409, "has terms");
    });
    it("switches the current term (one per school by design) and protects it from deletion", async () => {
      await call(P.admin, "calendar.setCurrentTerm", { schoolId: ACADEMY, termId: "s2026-t2" });
      expect((await school(ACADEMY).get()).data()).toMatchObject({ currentTermId: "s2026-t2", currentSessionId: "s2026" });
      await rejects(call(P.admin, "terms.delete", { schoolId: ACADEMY, id: "s2026-t2" }), 409, "current term");
      await call(P.admin, "calendar.setCurrentTerm", { schoolId: ACADEMY, termId: "s2026-t1" });
      expect((await school(GREENFIELD).get()).data()?.currentTermId).toBe("s2026-t1");
    });
  });

  describe("classes, arms and subjects", () => {
    it("class names are unique per school, any capitalisation", async () => {
      await rejects(call(P.admin, "levels.create", { schoolId: ACADEMY, name: "jss 1", section: "junior_secondary" }), 409);
      const { id } = await call(P.admin, "levels.create", { schoolId: ACADEMY, name: "Year 7", section: "junior_secondary" });
      expect((await school(ACADEMY).collection("classLevels").doc(id).get()).data()?.order).toBeGreaterThan(203);
      await call(P.admin, "levels.delete", { schoolId: ACADEMY, id });
    });
    it("cannot delete a class that has arms", async () => {
      await rejects(call(P.admin, "levels.delete", { schoolId: ACADEMY, id: await levelId("JSS 1") }), 409, "has arms");
    });
    it("form tutors must be teaching staff of this school", async () => {
      const arm = await armId("SS 1", "A");
      await rejects(call(P.admin, "arms.update", { schoolId: ACADEMY, id: arm, name: "A", formTutorId: "demo-parent1" }), 400, "must be a teacher");
      await rejects(call(P.admin, "arms.update", { schoolId: ACADEMY, id: arm, name: "A", formTutorId: "demo-bursar" }), 400, "must be a teacher");
      await rejects(call(P.admin, "arms.update", { schoolId: ACADEMY, id: arm, name: "A", formTutorId: "gf-teacher" }), 400, "must be a teacher");
      await call(P.admin, "arms.update", { schoolId: ACADEMY, id: arm, name: "A", formTutorId: "demo-teacher1", capacity: 35 });
    });
    it("arm names are unique within a class", async () => {
      await rejects(call(P.admin, "arms.create", { schoolId: ACADEMY, levelId: await levelId("JSS 1"), name: "a" }), 409);
    });
    it("subjects: unique name and code; cannot delete one in use", async () => {
      await rejects(call(P.admin, "subjects.create", { schoolId: ACADEMY, name: "mathematics", shortCode: "MAT", category: "core" }), 409, "name");
      await rejects(call(P.admin, "subjects.create", { schoolId: ACADEMY, name: "Maths 2", shortCode: "MTH", category: "core" }), 409, "code");
      await rejects(call(P.admin, "subjects.delete", { schoolId: ACADEMY, id: await subjectId("Mathematics") }), 409, "still offered");
      const { id } = await call(P.admin, "subjects.create", { schoolId: ACADEMY, name: "Music", shortCode: "mus", category: "arts" });
      expect((await school(ACADEMY).collection("subjects").doc(id).get()).data()?.shortCode).toBe("MUS");
      await call(P.admin, "subjects.delete", { schoolId: ACADEMY, id });
    });
    it("reorders classes within a section", async () => {
      const jss2 = await levelId("JSS 2");
      const before = (await school(ACADEMY).collection("classLevels").doc(jss2).get()).data()!.order;
      await call(P.admin, "levels.move", { schoolId: ACADEMY, id: jss2, direction: -1 });
      const after = (await school(ACADEMY).collection("classLevels").doc(jss2).get()).data()!.order;
      expect(after).toBeLessThan(before);
      await call(P.admin, "levels.move", { schoolId: ACADEMY, id: jss2, direction: 1 });
    });
  });

  describe("teacher assignments", () => {
    it("only subjects the class offers, only teaching staff, one teacher per subject", async () => {
      const arm = await armId("JSS 1", "A");
      await rejects(call(P.admin, "assignments.set", { schoolId: ACADEMY, armId: arm, subjectId: await subjectId("Biology"), teacherId: "demo-teacher1" }), 400, "not offered");
      await rejects(call(P.admin, "assignments.set", { schoolId: ACADEMY, armId: arm, subjectId: await subjectId("French"), teacherId: "demo-bursar" }), 400, "must be a teacher");
      // Re-assigning replaces the teacher (same document), never duplicates.
      const maths = await subjectId("Mathematics");
      await call(P.admin, "assignments.set", { schoolId: ACADEMY, armId: arm, subjectId: maths, teacherId: "demo-teacher2" });
      const same = await school(ACADEMY).collection("assignments").where("armId", "==", arm).where("subjectId", "==", maths).get();
      expect(same.size).toBe(1);
      expect(same.docs[0].data().teacherId).toBe("demo-teacher2");
      await call(P.admin, "assignments.set", { schoolId: ACADEMY, armId: arm, subjectId: maths, teacherId: "demo-teacher1" });
    });
    it("cannot drop a subject from a class while teachers are assigned, or delete an assigned arm", async () => {
      await rejects(call(P.admin, "levels.setSubject", { schoolId: ACADEMY, levelId: await levelId("JSS 1"), subjectId: await subjectId("Mathematics"), state: "none" }), 409, "remove those assignments");
      await rejects(call(P.admin, "arms.delete", { schoolId: ACADEMY, id: await armId("JSS 1", "A") }), 409);
    });
    it("cycles a subject offering compulsory -> elective -> none", async () => {
      const args = { schoolId: ACADEMY, levelId: await levelId("JSS 3"), subjectId: await subjectId("Biology") };
      await call(P.admin, "levels.setSubject", { ...args, state: "compulsory" });
      await call(P.admin, "levels.setSubject", { ...args, state: "elective" });
      expect((await school(ACADEMY).collection("classLevels").doc(args.levelId).get()).data()?.subjects[args.subjectId]).toBe("elective");
      await call(P.admin, "levels.setSubject", { ...args, state: "none" });
      expect((await school(ACADEMY).collection("classLevels").doc(args.levelId).get()).data()?.subjects[args.subjectId]).toBeUndefined();
    });
  });

  describe("template", () => {
    it("adds nursery once, then nothing on a second run", async () => {
      const first = await call(P.admin, "template.apply", { schoolId: ACADEMY, sections: ["nursery"] });
      expect(first.levelsAdded).toBe(3);
      const second = await call(P.admin, "template.apply", { schoolId: ACADEMY, sections: ["nursery", "primary"] });
      expect(second).toMatchObject({ levelsAdded: 0, subjectsAdded: 0 });
    });
  });

  describe("people and roles", () => {
    it("principal can invite teachers but not proprietors", async () => {
      const out = await call(P.principal, "members.invite", { schoolId: ACADEMY, role: "teacher", fullName: "Kemi Balogun", email: "kemi@demo.test" });
      expect(out).toMatchObject({ created: true, sendPasswordEmail: true });
      const user = (await db().collection("users").doc(out.uid).get()).data();
      expect(user?.memberships[ACADEMY]).toEqual({ roles: ["teacher"], status: "active" });
      await rejects(call(P.principal, "members.invite", { schoolId: ACADEMY, role: "proprietor", fullName: "New Owner", email: "owner2@demo.test" }), 403);
    });
    it("inviting an existing account adds the role (teacher who is also a parent)", async () => {
      const out = await call(P.admin, "members.invite", { schoolId: ACADEMY, role: "parent", fullName: "Funmi Adeyemi", email: P.teacher });
      expect(out.created).toBe(false);
      expect((await school(ACADEMY).collection("members").doc("demo-teacher1").get()).data()?.roles).toEqual(["teacher", "parent"]);
      await call(P.admin, "members.setRoles", { schoolId: ACADEMY, uid: "demo-teacher1", roles: ["teacher"] });
    });
    it("phone invites create a phone login; numbers are normalised", async () => {
      const out = await call(P.admin, "members.invite", { schoolId: ACADEMY, role: "parent", fullName: "Mrs Ada Uche", phone: "0803 555 0101" });
      expect((await school(ACADEMY).collection("members").doc(out.uid).get()).data()?.phone).toBe("+2348035550101");
      await rejects(call(P.admin, "members.invite", { schoolId: ACADEMY, role: "parent", fullName: "Bad Number", phone: "123" }), 400, "valid phone");
    });
    it("nobody can change their own access; admins cannot touch leadership above them", async () => {
      await rejects(call(P.admin, "members.setStatus", { schoolId: ACADEMY, uid: "demo-school-admin", status: "suspended" }), 400, "your own");
      await rejects(call(P.admin, "members.setStatus", { schoolId: ACADEMY, uid: "demo-principal", status: "suspended" }), 403);
      await rejects(call(P.admin, "members.setRoles", { schoolId: ACADEMY, uid: "demo-bursar", roles: ["proprietor"] }), 403);
    });
    it("the last active proprietor cannot be removed, suspended or demoted", async () => {
      await rejects(call(P.platform, "members.setStatus", { schoolId: ACADEMY, uid: "demo-proprietor", status: "suspended" }), 409, "at least one active proprietor");
      await rejects(call(P.platform, "members.setRoles", { schoolId: ACADEMY, uid: "demo-proprietor", roles: ["principal"] }), 409);
      await rejects(call(P.platform, "members.remove", { schoolId: ACADEMY, uid: "demo-proprietor" }), 409);
    });
    it("proprietor can suspend and reactivate the principal", async () => {
      await call(P.proprietor, "members.setStatus", { schoolId: ACADEMY, uid: "demo-principal", status: "suspended" });
      await rejects(call(P.principal, "levels.create", { schoolId: ACADEMY, name: "X1", section: "primary" }), 403);
      await call(P.proprietor, "members.setStatus", { schoolId: ACADEMY, uid: "demo-principal", status: "active" });
    });
    it("cannot remove a teacher who still has classes; can suspend instead", async () => {
      await rejects(call(P.admin, "members.remove", { schoolId: ACADEMY, uid: "demo-teacher1" }), 409, "reassign");
    });
    it("can only switch to a school you belong to", async () => {
      await rejects(call(P.teacher, "me.setActiveSchool", { schoolId: GREENFIELD }), 403);
      await call(P.teacher, "me.setActiveSchool", { schoolId: ACADEMY });
    });
  });

  describe("school profile", () => {
    it("admins update settings; phone normalised; bad colours rejected", async () => {
      await call(P.admin, "schools.update", {
        schoolId: ACADEMY,
        name: "Wepluz Demo Academy",
        settings: { motto: "New motto", phone: "0801 234 5678", email: "info@demo.test", primaryColor: "#14213D", accentColor: "#0F766E" },
      });
      expect((await school(ACADEMY).get()).data()?.settings).toMatchObject({ motto: "New motto", phone: "+2348012345678" });
      await rejects(call(P.admin, "schools.update", { schoolId: ACADEMY, name: "W", settings: { primaryColor: "red", accentColor: "#000000" } }), 400);
      await rejects(call(P.teacher, "schools.update", { schoolId: ACADEMY, name: "Mine now", settings: { primaryColor: "#000000", accentColor: "#000000" } }), 403);
    });
    it("logo upload stores a small image and shows on the public branding", async () => {
      const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      await call(P.admin, "schools.setLogo", { schoolId: ACADEMY, dataUrl: png });
      const branding = await call(null, "branding.get", { slug: "wepluz-demo" });
      expect(branding).toMatchObject({ name: "Wepluz Demo Academy", logo: png });
      await rejects(call(P.admin, "schools.setLogo", { schoolId: ACADEMY, dataUrl: "data:text/html;base64,PGgxPg==" }), 400);
      expect(await call(null, "branding.get", { slug: "no-such-school" })).toBeNull();
    });
  });

  describe("audit log", () => {
    it("records who changed what, with before and after", async () => {
      await call(P.admin, "subjects.update", { schoolId: ACADEMY, id: await subjectId("French"), name: "French Language", shortCode: "FRE", category: "language" });
      const log = await school(ACADEMY).collection("auditLog").where("entity", "==", "subject").where("action", "==", "update").get();
      const entry = log.docs.map((d) => d.data()).find((e) => e.after?.name === "French Language")!;
      expect(entry).toMatchObject({ actorId: "demo-school-admin", actorEmail: P.admin, before: { name: "French" } });
      expect(entry.changedFields).toContain("name");
    });
  });

  describe("parent SMS login (Termii, faked in tests)", () => {
    beforeEach(() => void (sentSms.length = 0));
    it("sends a code to a registered parent and signs them in with it", async () => {
      await call(null, "otp.request", { phone: "0803 000 0001" });
      expect(sentSms[0].phone).toBe("+2348030000001");
      const code = sentSms[0].message.match(/\d{6}/)![0];
      await rejects(call(null, "otp.verify", { phone: "08030000001", code: code === "000000" ? "111111" : "000000" }), 400, "wrong or has expired");
      const { customToken } = await call(null, "otp.verify", { phone: "+2348030000001", code });
      expect(customToken).toBeTruthy();
      await rejects(call(null, "otp.verify", { phone: "+2348030000001", code }), 400, "wrong or has expired");
    });
    it("rejects unknown numbers and quick resends; locks after 5 wrong tries", async () => {
      await rejects(call(null, "otp.request", { phone: "08099999999" }), 404, "not registered");
      await call(null, "otp.request", { phone: "08030000002" });
      await rejects(call(null, "otp.request", { phone: "08030000002" }), 429);
      const code = sentSms[0].message.match(/\d{6}/)![0];
      const wrong = code === "123456" ? "654321" : "123456";
      for (let i = 0; i < 5; i++) await rejects(call(null, "otp.verify", { phone: "08030000002", code: wrong }), 400);
      await rejects(call(null, "otp.verify", { phone: "08030000002", code }), 400, "wrong or has expired");
    });
  });
});
