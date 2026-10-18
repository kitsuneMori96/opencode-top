// Test-only shim for `node:sqlite`.
//
// Vite/vite-node do not recognise `node:sqlite` as a builtin (it is missing
// from `module.builtinModules`), so they strip the `node:` prefix and fail to
// resolve it. Re-export the real builtin through `createRequire` instead, and
// alias `node:sqlite` to this file from vitest.config.ts.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sqlite = require("node:sqlite") as typeof import("node:sqlite");

export const DatabaseSync = sqlite.DatabaseSync;
export type StatementSync = import("node:sqlite").StatementSync;
