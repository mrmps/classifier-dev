import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => ({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  plugins: [
    {
      name: "classifier-markdown",
      transform(code, id) {
        if (id.endsWith(".md"))
          return { code: `export default ${JSON.stringify(code)}`, map: null };
      },
    },
    cloudflare({
      configPath: command === "serve" ? "wrangler.local.toml" : "wrangler.toml",
      viteEnvironment: { name: "ssr" },
    }),
    tanstackStart({ serverFns: { base: "/_server" } }),
    react(),
    tailwindcss(),
  ],
}));
