import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const chonkieEntry = import.meta.resolve("@chonkiejs/chunk");
const chonkieWorkerId = "\0chonkie-worker";

export default defineConfig(({ command }) => ({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  plugins: [
    {
      name: "chonkie-worker-wasm",
      enforce: "pre",
      resolveId(source) {
        if (source === "@chonkiejs/chunk") return chonkieWorkerId;
      },
      load(id) {
        if (id !== chonkieWorkerId) return;
        const entry = JSON.stringify(fileURLToPath(chonkieEntry));
        const bindings = JSON.stringify(fileURLToPath(new URL("./pkg/chonkiejs_chunk.js", chonkieEntry)));
        const wasm = JSON.stringify(fileURLToPath(new URL("./pkg/chonkiejs_chunk_bg.wasm", chonkieEntry)) + "?module");
        return `export * from ${entry};
import { initSync } from ${bindings};
import wasm from ${wasm};
export async function init() { initSync({ module: wasm }); }`;
      },
    },
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
