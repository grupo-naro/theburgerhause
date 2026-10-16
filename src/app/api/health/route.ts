import { createHealthHandler } from "@/lib/health";

// Liveness/readiness probe for Nginx, uptime monitors and deploy.sh. Logic lives in lib/health.ts.
// Dynamic by construction: the handler reads the request headers and the DB on every call.
export const GET = createHealthHandler();
