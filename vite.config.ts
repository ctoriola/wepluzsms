import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// In local development, serve the same /api/rpc function Vercel runs in production,
// so `npm run dev` gives you the whole app on one port.
function localApi(): Plugin {
  return {
    name: "wepluz-local-api",
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), "");
      for (const [k, v] of Object.entries(env)) if (!k.startsWith("VITE_") && process.env[k] === undefined) process.env[k] = v;
      if (env.VITE_USE_EMULATORS === "true") {
        process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8085";
        process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
        process.env.GCLOUD_PROJECT ??= "demo-wepluz";
      }
      server.middlewares.use("/api/rpc", async (req, res) => {
        try {
          const mod = await server.ssrLoadModule("/api/rpc.ts");
          await mod.default(req, res);
        } catch (err) {
          console.error(err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "Local API failed to load. See the terminal." }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApi()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: { port: 8080 },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
