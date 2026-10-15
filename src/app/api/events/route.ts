import { createEventsHandler } from "@/lib/events/sse";

// Staff-only Server-Sent Events stream (see docs/ops/realtime.md). Logic lives in lib/events/sse.ts.
export const GET = createEventsHandler();
