import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_PAGE_PREFIX, SURFACE } from "./surface";
import { renderSurfaceDoc } from "./surface-doc";
import { exportsOf, firstIndex, functionSource, hasFileLevelUseServer, scanSource, stripComments } from "./scan";

const ROOT = process.cwd();
const scan = scanSource(ROOT);
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const isAdminPage = (key: string) => key.startsWith(ADMIN_PAGE_PREFIX);
const classified = new Set(Object.keys(SURFACE));
const found = [...scan.actions, ...scan.routes, ...scan.pages.filter((p) => !isAdminPage(p))];

describe("authorization surface", () => {
  it("the scan finds the expected kinds of entry (sanity, so an empty scan cannot pass)", () => {
    expect(scan.problems).toEqual([]);
    expect(scan.actions.length).toBeGreaterThanOrEqual(39);
    expect(scan.routes.length).toBeGreaterThanOrEqual(9);
    expect(scan.pages.length).toBeGreaterThanOrEqual(30);
  });

  it("every Server Action export, Route Handler method and page is classified (a new endpoint FAILS until it is)", () => {
    const unclassified = found.filter((k) => !classified.has(k));
    expect(unclassified, "add these to src/lib/security/surface.ts with their access class").toEqual([]);
  });

  it("no classified entry is stale (renamed or deleted code)", () => {
    const present = new Set(found);
    const stale = [...classified].filter((k) => !present.has(k));
    expect(stale, "remove these from src/lib/security/surface.ts").toEqual([]);
  });

  it("every non-public entry names its roles; admin entries are admin only; every entry points to existing tests", () => {
    for (const [key, e] of Object.entries(SURFACE)) {
      if (e.access === "staff" || e.access === "admin") {
        expect(e.roles?.length, key).toBeGreaterThan(0);
        if (e.access === "admin") expect(e.roles, key).toEqual(["admin"]);
      } else {
        expect(e.roles, key).toBeUndefined();
      }
      expect(e.tests.length, `${key} must point to the test(s) that assert it`).toBeGreaterThan(0);
      for (const t of e.tests) expect(() => read(t), `${key}: test file ${t} does not exist`).not.toThrow();
    }
  });

  it("non-public Server Actions authorize BEFORE any database access (static check)", () => {
    const auth = [/\bauthorizeAdmin\(/, /\bauthorize\(/, /\bquick\(/, /\brequireRole\(/, /\brequireSessionOrRedirect\(/];
    const touching = [/\bgetDb\(/, /\bgetSessionToken\(/, /\bcookies\(\)/];
    for (const [key, e] of Object.entries(SURFACE)) {
      if (!key.startsWith("action:") || (e.access !== "staff" && e.access !== "admin")) continue;
      const [file, name] = key.slice("action:".length).split("#");
      const body = stripComments(functionSource(read(file), name) ?? "");
      expect(body.length, `${key}: function source not found`).toBeGreaterThan(0);
      const a = firstIndex(body, auth);
      expect(a, `${key}: no authorization call`).toBeGreaterThanOrEqual(0);
      const d = firstIndex(body, touching);
      if (d >= 0) expect(a, `${key}: touches the DB/cookies before authorizing`).toBeLessThan(d);
    }
  });

  it("every protected page carries a guard marker (page, shell or workspace component)", () => {
    const markers = /\b(requireSessionOrRedirect|requireWorkspace|requireGeneralView)\(|<SectorWorkspacePage\b/;
    for (const page of scan.pages) {
      const entry = SURFACE[page];
      const protectedPage = isAdminPage(page) || (entry && (entry.access === "staff" || entry.access === "admin"));
      if (!protectedPage) continue;
      const src = stripComments(read(page.slice("page:".length)));
      // The admin index only redirects to /admin/menu (guarded) and renders nothing.
      const redirectOnly = isAdminPage(page) && /\bredirect\(/.test(src) && !/getDb/.test(src);
      expect(markers.test(src) || redirectOnly, `${page}: no session guard`).toBe(true);
    }
    // The shared workspace component really guards (retiro/delivery pages delegate to it).
    expect(read("src/components/staff/sector-workspace-page.tsx")).toMatch(/requireWorkspace\(/);
  });

  it("the committed docs/ops/security-surface.md matches the registry", () => {
    const file = path.join(ROOT, "docs/ops/security-surface.md");
    const expected = renderSurfaceDoc();
    if (process.env.UPDATE_SURFACE_DOC === "1") writeFileSync(file, expected);
    expect(readFileSync(file, "utf8").replace(/\r\n/g, "\n"), "run: UPDATE_SURFACE_DOC=1 pnpm test:security").toBe(expected);
  });
});

describe("scanner", () => {
  it("recognizes the directive only at file level and ignores prose", () => {
    expect(hasFileLevelUseServer('"use server";\nexport async function a() {}')).toBe(true);
    expect(hasFileLevelUseServer('// "use server"\nexport async function a() {}')).toBe(false);
    expect(hasFileLevelUseServer('/** doc */\n"use server"\n')).toBe(true);
    expect(hasFileLevelUseServer('import x from "y";\n"use server";')).toBe(false);
  });

  it("lists function, const and re-exports", () => {
    const names = exportsOf("export async function a() {}\nexport const GET = f();\nexport { b as POST, c };\nexport function d() {}\nexport type T = 1;");
    expect(names.map((n) => n.name).sort()).toEqual(["GET", "POST", "a", "c", "d"]);
    expect(names.find((n) => n.name === "a")?.kind).toBe("async-function");
    expect(names.find((n) => n.name === "d")?.kind).toBe("other");
  });
  it("sees re-exports from other modules (they can not be classified, so they surface as non-async exports)", () => {
    const src = ["export * from \"./x\";", "export * as ns from \"./y\";", "export { z as act } from \"./z\";", "export type * from \"./t\";"].join("\n");
    const names = exportsOf(src);
    expect(names.map((n) => n.name).sort()).toEqual(["*", "*", "act", "ns"]);
    expect(names.every((n) => n.kind === "other")).toBe(true);
  });
});
