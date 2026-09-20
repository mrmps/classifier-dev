import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// /admin is a password-gated Worker document, outside the account-app router.
// Ship its chart island through the same Vite pipeline, with no CDN scripts.
export default defineConfig({
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "public/admin-assets",
    emptyOutDir: true,
    copyPublicDir: false,
    lib: {
      entry: "src/features/admin/client.tsx",
      formats: ["iife"],
      name: "AdminAnalytics",
      fileName: () => "admin.js",
      cssFileName: "admin",
    },
  },
});
