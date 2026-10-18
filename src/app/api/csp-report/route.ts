import { createCspReportHandler } from "@/lib/security/csp-report";

// Content-Security-Policy violation reports (report-only phase, see docs/ops/runbook.md). No auth, no cookies;
// rate limited, body never stored. Logic lives in lib/security/csp-report.ts.
export const POST = createCspReportHandler();
