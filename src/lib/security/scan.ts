import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Static scan of the source tree for the authorization surface (see surface.ts). Node-only helper for
 * the surface test: regex based on purpose (no TypeScript compiler dependency), strict enough for this
 * codebase and conservative where it cannot be sure (anything odd becomes a reported problem).
 */

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export type Scan = {
  /** `action:<file>#<export>` for every export of a "use server" file. */
  actions: string[];
  /** `route:<file>#<METHOD>` for every HTTP method of a route.ts. */
  routes: string[];
  /** `page:<file>` for every page.tsx. */
  pages: string[];
  /** Human readable problems (inline "use server", non-function exports of a "use server" file, ...). */
  problems: string[];
};

const toPosix = (p: string) => p.split(path.sep).join("/");

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
}

/** Source without comments, so a directive or export mentioned in prose does not count. */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

export function hasFileLevelUseServer(src: string): boolean {
  return /^\s*(["'])use server\1/.test(stripComments(src));
}

type Export = { name: string; kind: "async-function" | "other" };

export function exportsOf(src: string): Export[] {
  const code = stripComments(src);
  const found: Export[] = [];
  for (const m of code.matchAll(/^export\s+(async\s+)?function\s*\*?\s*(\w+)/gm)) {
    found.push({ name: m[2], kind: m[1] ? "async-function" : "other" });
  }
  for (const m of code.matchAll(/^export\s+(?:const|let|var|class)\s+(\w+)/gm)) found.push({ name: m[1], kind: "other" });
  for (const m of code.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) found.push({ name, kind: "other" });
    }
  }
  // `export * from "./x"` hides what is exported, so it can not be classified: it surfaces as an unknown export.
  for (const m of code.matchAll(/^export\s+(?:type\s+)?\*\s*(?:as\s+(\w+)\s+)?from\b/gm)) found.push({ name: m[1] ?? "*", kind: "other" });
  if (/^export\s+default\b/m.test(code)) found.push({ name: "default", kind: "other" });
  return found;
}

export function scanSource(root: string): Scan {
  const files: string[] = [];
  walk(path.join(root, "src"), files);
  files.sort();
  const scan: Scan = { actions: [], routes: [], pages: [], problems: [] };

  for (const abs of files) {
    const rel = toPosix(path.relative(root, abs));
    const src = readFileSync(abs, "utf8");
    const code = stripComments(src);
    const fileLevel = hasFileLevelUseServer(src);

    if (!fileLevel && /^[ \t]+(["'])use server\1/m.test(code)) {
      scan.problems.push(`${rel}: inline "use server" inside a function. Move it to a file-level actions.ts so it can be classified.`);
    }

    if (fileLevel) {
      for (const e of exportsOf(src)) {
        if (e.kind !== "async-function") scan.problems.push(`${rel}: "use server" file exports non-async-function '${e.name}'`);
        scan.actions.push(`action:${rel}#${e.name}`);
      }
    }

    const base = path.basename(rel);
    if (/^route\.tsx?$/.test(base)) {
      const methods = exportsOf(src).filter((e) => (HTTP_METHODS as readonly string[]).includes(e.name));
      if (methods.length === 0) scan.problems.push(`${rel}: route file without an HTTP method export`);
      for (const e of methods) scan.routes.push(`route:${rel}#${e.name}`);
    }
    if (/^page\.tsx?$/.test(base)) scan.pages.push(`page:${rel}`);
  }
  return scan;
}

/** Slice of a file holding one exported function (up to the next top-level export). */
export function functionSource(src: string, name: string): string | null {
  const start = src.search(new RegExp("^export\\s+async\\s+function\\s+" + name + "\\b", "m"));
  if (start < 0) return null;
  const rest = src.slice(start + 1);
  const next = rest.search(/^export\s/m);
  return next < 0 ? rest : rest.slice(0, next);
}

/** Index of the first occurrence of any pattern (-1 when none). */
export function firstIndex(src: string, patterns: RegExp[]): number {
  const idx = patterns.map((p) => src.search(p)).filter((i) => i >= 0);
  return idx.length ? Math.min(...idx) : -1;
}
