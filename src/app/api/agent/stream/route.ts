import { createAgentStreamHandler } from "@/lib/print/agent-stream";

// Token-authenticated SSE stream for the print agents (see docs/ops/print-agent-protocol.md).
// Logic lives in lib/print/agent-stream.ts; no cookies, no CORS.
export const GET = createAgentStreamHandler();
