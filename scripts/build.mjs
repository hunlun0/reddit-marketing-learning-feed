/** Plain ES modules need no transpiler. This produces a dependency-free source/asset build.
 * Wrangler bundling and workerd validation remain the separate `build:worker` acceptance gate.
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { check, root } from "./check.mjs";
await check();
const out = resolve(root, "dist"); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
for (const entry of ["src", "public", "wrangler.jsonc", "package.json"]) await cp(resolve(root, entry), resolve(out, entry), { recursive: true });
console.log("PASS: source/asset build created in dist/. Deploy from the repository root. This is NOT a Wrangler/workerd test.");
