import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const root = fileURLToPath(new URL("../", import.meta.url));
async function files(dir) { const entries = await readdir(dir, { withFileTypes: true }); return (await Promise.all(entries.map(e => e.isDirectory() ? files(resolve(dir, e.name)) : resolve(dir, e.name)))).flat(); }
export async function check() {
  const sources = (await Promise.all(["src", "public", "tests", "scripts"].map(d => files(resolve(root, d))))).flat().filter(p => /\.(m?js)$/.test(p));
  for (const path of sources) {
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Syntax check failed: ${path}\n${result.stderr}`);
  }
  // Strong bans for the application browser code; no HTML interpolation or client-side credentials storage.
  const app = await readFile(resolve(root, "public/app.js"), "utf8");
  if (/\.innerHTML\s*=|insertAdjacentHTML|document\.write\s*\(|localStorage\.|sessionStorage\./.test(app)) throw new Error("Unsafe DOM/browser persistence pattern found");
  const worker = await import(new URL("../src/index.js", import.meta.url));
  if (typeof worker.default.fetch !== "function" || typeof worker.default.scheduled !== "function") throw new Error("Worker handlers missing");
  console.log(`PASS: ${sources.length} JavaScript modules parsed; Worker exports and browser safety checks passed.`);
  return sources.length;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await check();
