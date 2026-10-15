import { createHeartbeatHandler } from "@/lib/print/agent-routes";

// Print agent keep-alive (see docs/ops/print-agent-protocol.md). Token auth only; no cookies, no CORS.
export const POST = createHeartbeatHandler();
