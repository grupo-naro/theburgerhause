import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "Retiro en local" (the old cashier screen) was merged into Mostrador: no user-facing text may still send the
 * cashier to it. Scans the UI source for the string inside string/JSX literals (comments are allowed).
 */
function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) tsxFiles(full, out);
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) out.push(full);
  }
  return out;
}

describe("no UI copy points to the removed Retiro en local screen", () => {
  it("no component text mentions it", () => {
    const root = path.resolve(__dirname, "../../");
    const offenders = [...tsxFiles(path.join(root, "components")), ...tsxFiles(path.join(root, "app"))].filter((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .some((line) => /Retiro en local/.test(line) && !/^\s*(\*|\/\/|\/\*)/.test(line)),
    );
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });
});
