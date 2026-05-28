import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Dev/preview proxy: forward /v1 (and /.well-known) to the configured KeepChill
// gateway so the browser sees only same-origin requests. This avoids the CORS
// wall on /v1/jobs/{job_id} when running the example from http://localhost:5173.
//
// Override the target by exporting VITE_KC_API_URL=https://api.staging.keepchill.io
// before `npm run dev` if you want to point the example at staging.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_KC_API_URL || "https://api.keepchill.io";

  return {
    plugins: [react()],
    build: {
      target: "ES2022",
    },
    server: {
      proxy: {
        "/v1": {
          target,
          changeOrigin: true,
          secure: true,
        },
        "/.well-known": {
          target,
          changeOrigin: true,
          secure: true,
        },
      },
    },
    preview: {
      proxy: {
        "/v1": {
          target,
          changeOrigin: true,
          secure: true,
        },
      },
    },
  };
});
