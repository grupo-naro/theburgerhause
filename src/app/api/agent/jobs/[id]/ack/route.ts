import { createAckHandler } from "@/lib/print/agent-routes";

// Print agent acknowledgement of one job (see docs/ops/print-agent-protocol.md). Token auth only; no cookies, no CORS.
export const POST = createAckHandler();
