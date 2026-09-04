// Emits the source file tree as JSON for a manual Vercel file deployment
// (used when no git remote is available). Binary files are base64.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skipDirs = new Set(["node_modules", ".next", ".git", ".claude", "tests", "coverage", ".vercel", "scripts", "supabase"]);
const skipFiles = new Set([".env.local", "pnpm-lock.yaml", "tsconfig.tsbuildinfo", "next-env.d.ts"]);
const out = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(root, p).split("\\").join("/");
    if (skipDirs.has(name) || skipFiles.has(name)) continue;
    if (statSync(p).isDirectory()) {
      walk(p);
    } else if (/\.(png|ico|woff2?)$/.test(name)) {
      out.push({ file: rel, data: readFileSync(p).toString("base64"), encoding: "base64" });
    } else {
      out.push({ file: rel, data: readFileSync(p, "utf8") });
    }
  }
}

walk(root);
writeFileSync(join(root, "scripts/.deploy-files.json"), JSON.stringify(out));
console.log(out.length, "files", JSON.stringify(out).length, "bytes");
for (const f of out) console.log(f.file, f.data.length);
