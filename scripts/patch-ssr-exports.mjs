#!/usr/bin/env node
/**
 * Rolldown splits the TanStack Start SSR entry into `_ssr/ssr.mjs` + `ssr2.mjs`
 * with a circular import and a wrong `s` export. Node then fails every request
 * with `{ error: true, status: 500, unhandled: true }`.
 *
 * - ssr2.mjs imported `__exportAll` from ssr.mjs while ssr.mjs imported
 *   `server_exports` from ssr2.mjs (cycle → "__exportAll is not a function").
 * - ssr.mjs re-exported a missing `ssr_exports` as `s`. Nitro calls `mod.s.fetch`.
 *   `s` must be `server_default` (the Start fetch entry).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const roots = [".vercel/output", ".output"];

const EXPORT_ALL = `function __exportAllLocal(all, no_symbols) {
  const target = {};
  for (const name in all) Object.defineProperty(target, name, { get: all[name], enumerable: true });
  if (!no_symbols) Object.defineProperty(target, Symbol.toStringTag, { value: "Module" });
  return target;
}
`;

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, acc);
    else if (name === "ssr.mjs" || name === "ssr2.mjs") acc.push(p);
  }
  return acc;
}

function patchSsr2(file, src) {
  if (!src.includes("./ssr.mjs") && !src.includes("__exportAll$1")) return src;
  let next = src.replace(/import\s*\{[^}]*\}\s*from\s*["']\.\/ssr\.mjs["']\s*;?\n?/, "");
  next = next.replaceAll("__exportAll$1", "__exportAllLocal");
  if (!next.includes("function __exportAllLocal")) {
    const match = next.match(/^(?:import[\s\S]*?;\n)+/);
    if (match) next = match[0] + EXPORT_ALL + next.slice(match[0].length);
    else next = EXPORT_ALL + next;
  }
  if (next !== src) console.log("[patch-ssr] broke ssr2 cycle", file);
  return next;
}

function patchSsr(file, src) {
  let next = src;
  if (next.includes("ssr_exports as s")) {
    next = next.replace("ssr_exports as s", "server_default as s");
    console.log("[patch-ssr] s → server_default", file);
  }
  if (next.includes("ssr_exports") && !/\b(?:const|let|var|function)\s+ssr_exports\b/.test(next)) {
    next = next.replace(
      /(\nexport \{)/,
      '\nvar ssr_exports = typeof server_exports === "undefined" ? {} : server_exports;$1',
    );
  }
  return next;
}

let patched = 0;
for (const root of roots) {
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");
    const next = file.endsWith("ssr2.mjs") ? patchSsr2(file, src) : patchSsr(file, src);
    if (next === src) continue;
    writeFileSync(file, next);
    patched += 1;
  }
}

if (!patched) console.log("[patch-ssr] nothing to patch");
