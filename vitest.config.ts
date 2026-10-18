import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `node:sqlite` is an experimental Node builtin that is missing from
// `module.builtinModules`, so Vite/vite-node do not treat it as external and
// fail to resolve it. Route it through a shim that loads the real builtin.
export default defineConfig({
  resolve: {
    alias: {
      "node:sqlite": fileURLToPath(new URL("./src/tests/node-sqlite-shim.ts", import.meta.url)),
    },
  },
});
