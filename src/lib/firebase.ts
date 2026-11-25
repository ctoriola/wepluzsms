import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

const env = import.meta.env;

/** Local development against the Firebase emulators (npm run emulators). */
export const useEmulators = env.VITE_USE_EMULATORS === "true";

// These web config values are public by design; security comes from
// firestore.rules and the server API, not from hiding them.
const config = useEmulators
  ? { apiKey: "demo-key", authDomain: "127.0.0.1", projectId: "demo-wepluz", appId: "demo-app" }
  : {
      apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
      projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
      appId: env.VITE_FIREBASE_APP_ID as string | undefined,
    };

export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);
if (!isFirebaseConfigured) {
  console.warn("Firebase is not configured. Add the VITE_FIREBASE_* values (see .env.example).");
}

export const firebaseApp = initializeApp(isFirebaseConfigured ? config : { apiKey: "missing", projectId: "missing", appId: "missing" });
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8085);
}
