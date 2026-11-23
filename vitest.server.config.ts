import { defineConfig } from "vitest/config";

// Server + security rules tests. Run inside the Firebase emulators:
//   npm run test:server
export default defineConfig({
  test: {
    include: ["tests/server/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      GCLOUD_PROJECT: "demo-wepluz",
      SETUP_TOKEN: "test-setup-token",
    },
  },
});
