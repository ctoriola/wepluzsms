// Firestore security rules: what each person can READ (all client writes are denied).
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { getFirestore as adminDb } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";
import { adminApp } from "../../server/core.js";
import { ACADEMY, GREENFIELD, installDemo, PROJECT } from "./helpers.js";

let env: RulesTestEnvironment;
const as = (uid: string, claims: Record<string, unknown> = {}) => env.authenticatedContext(uid, claims).firestore();
const s = (sid: string, ...p: string[]) => [`schools/${sid}`, ...p].join("/");

beforeAll(async () => {
  await installDemo();
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8085 },
  });
});
afterAll(async () => {
  await env?.cleanup();
});

describe("anonymous visitors", () => {
  it("cannot read schools, users or login codes", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, s(ACADEMY))));
    await assertFails(getDocs(collection(db, s(ACADEMY, "classLevels"))));
    await assertFails(getDoc(doc(db, "users/demo-teacher1")));
    await assertFails(getDocs(collection(db, "otpCodes")));
    await assertFails(getDoc(doc(db, "platform/config")));
  });
});

describe("teacher", () => {
  it("reads own school, structure, assignments and own records", async () => {
    const db = as("demo-teacher1");
    await assertSucceeds(getDoc(doc(db, s(ACADEMY))));
    await assertSucceeds(getDocs(collection(db, s(ACADEMY, "classLevels"))));
    await assertSucceeds(getDocs(collection(db, s(ACADEMY, "subjects"))));
    await assertSucceeds(getDocs(collection(db, s(ACADEMY, "terms"))));
    await assertSucceeds(getDocs(collection(db, s(ACADEMY, "assignments"))));
    await assertSucceeds(getDoc(doc(db, s(ACADEMY, "members/demo-teacher1"))));
    await assertSucceeds(getDoc(doc(db, "users/demo-teacher1")));
  });
  it("cannot read other people, the audit log or another school", async () => {
    const db = as("demo-teacher1");
    await assertFails(getDocs(collection(db, s(ACADEMY, "members"))));
    await assertFails(getDoc(doc(db, s(ACADEMY, "members/demo-parent1"))));
    await assertFails(getDocs(collection(db, s(ACADEMY, "auditLog"))));
    await assertFails(getDoc(doc(db, "users/demo-proprietor")));
    await assertFails(getDoc(doc(db, s(GREENFIELD))));
    await assertFails(getDocs(collection(db, s(GREENFIELD, "classLevels"))));
  });
  it("cannot write anything directly", async () => {
    const db = as("demo-teacher1");
    await assertFails(setDoc(doc(db, s(ACADEMY, "classLevels/hack")), { name: "Hack" }));
    await assertFails(updateDoc(doc(db, s(ACADEMY, "members/demo-teacher1")), { roles: ["proprietor"] }));
    await assertFails(updateDoc(doc(db, "users/demo-teacher1"), { fullName: "X" }));
  });
});

describe("parent", () => {
  it("reads class names and calendar but not teacher assignments", async () => {
    const db = as("demo-parent1");
    await assertSucceeds(getDocs(collection(db, s(ACADEMY, "classLevels"))));
    await assertSucceeds(getDocs(collection(db, s(ACADEMY, "terms"))));
    await assertFails(getDocs(collection(db, s(ACADEMY, "assignments"))));
    await assertFails(getDocs(collection(db, s(ACADEMY, "members"))));
  });
});

describe("leadership", () => {
  it("school admin reads all members but not the audit log", async () => {
    const db = as("demo-school-admin");
    await assertSucceeds(getDocs(collection(db, s(ACADEMY, "members"))));
    await assertFails(getDocs(collection(db, s(ACADEMY, "auditLog"))));
  });
  it("proprietor reads own audit log, not another school's", async () => {
    const db = as("demo-proprietor");
    await assertSucceeds(getDocs(collection(db, s(ACADEMY, "auditLog"))));
    await assertFails(getDocs(collection(db, s(GREENFIELD, "auditLog"))));
    await assertFails(getDocs(collection(db, s(GREENFIELD, "members"))));
  });
  it("platform admin (claim) reads every school", async () => {
    const db = as("demo-platform-admin", { platformAdmin: true });
    await assertSucceeds(getDocs(collection(db, "schools")));
    await assertSucceeds(getDocs(collection(db, s(GREENFIELD, "members"))));
  });
  it("a fake platformAdmin field in someone's own data does not count", async () => {
    const db = as("demo-teacher1", { platformAdmin: "yes" });
    await assertFails(getDocs(collection(db, "schools")));
  });
});

describe("suspension", () => {
  it("a suspended member loses access", async () => {
    await adminDb(adminApp()).doc(s(ACADEMY, "members/demo-bursar")).update({ status: "suspended" });
    await assertFails(getDoc(doc(as("demo-bursar"), s(ACADEMY))));
    await adminDb(adminApp()).doc(s(ACADEMY, "members/demo-bursar")).update({ status: "active" });
    await assertSucceeds(getDoc(doc(as("demo-bursar"), s(ACADEMY))));
  });
  it("everyone loses access when their school is suspended", async () => {
    await adminDb(adminApp()).doc(s(GREENFIELD)).update({ status: "suspended" });
    await assertFails(getDoc(doc(as("gf-proprietor"), s(GREENFIELD))));
    await adminDb(adminApp()).doc(s(GREENFIELD)).update({ status: "active" });
  });
});
