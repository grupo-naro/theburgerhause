import { SURFACE, type Entry } from "./surface";

/** docs/ops/security-surface.md is GENERATED from SURFACE (`UPDATE_SURFACE_DOC=1 pnpm test:security`); the test fails when it is stale. */

const cell = (s: string) => s.replace(/\|/g, "\\|");
const rolesOf = (e: Entry) => (e.roles ? e.roles.join(", ") : "-");

function table(prefix: string): string[] {
  const rows = Object.entries(SURFACE)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, e]) => {
      const where = key.slice(prefix.length);
      return `| \`${cell(where)}\` | ${e.access} | ${rolesOf(e)} | ${cell(e.note)} | ${e.tests.map((t) => `\`${cell(t)}\``).join("<br>")} |`;
    });
  return ["| Entry | Access | Roles | Guard / abuse bound | Tests |", "| --- | --- | --- | --- | --- |", ...rows];
}

export function renderSurfaceDoc(): string {
  return [
    "# Authorization surface (generated)",
    "",
    "Generated from `src/lib/security/surface.ts` by `src/lib/security/surface-doc.ts`; do not edit by hand.",
    "Regenerate with `UPDATE_SURFACE_DOC=1 pnpm test:security`. `pnpm test:security` fails when:",
    "",
    "- a Server Action export, Route Handler method or page exists in `src/` without an entry here (a new endpoint must be classified on purpose),",
    "- an entry here no longer exists in the code,",
    "- a non-public Server Action does not call its authorization helper before touching the database (static check),",
    "- the behavioural tests in `src/lib/security/authz.test.ts` show that an action or route lets an anonymous or wrong-role caller through, or touches the database before authorizing,",
    "- this file is stale.",
    "",
    "Access classes: `public` (no credential; has an abuse bound), `staff` (session + role list; **admin is never implicit**), `admin`, `agent-token` (Bearer station token, no cookies), `capability-token` (the unguessable URL token is the credential).",
    "Staff actions on orders additionally apply the sector rule server side (a cashier at a Delivery station is refused; admin is exempt).",
    "",
    "## Server Actions (every one is a public HTTP endpoint)",
    "",
    ...table("action:"),
    "",
    "## Route Handlers",
    "",
    ...table("route:"),
    "",
    "## Pages",
    "",
    'Every page under `src/app/(admin)/admin/**` is admin-only: the page (or, for the index redirect, the admin shell) calls `requireSessionOrRedirect(["admin"])`. The scanner enforces a guard marker on each of them.',
    "",
    ...table("page:"),
    "",
  ].join("\n");
}
