import { z } from "zod";

/**
 * The one place the app imports zod from. In the BROWSER zod runs without its JIT: zod 4 probes
 * `Function("")` to learn whether eval is allowed, and under a Content-Security-Policy without
 * 'unsafe-eval' that probe is itself reported as a violation (it is caught, so nothing breaks, but
 * every page load would log one). Schemas here are tiny, the interpreter is just as fast for them.
 * The server keeps the JIT. Import `z` from "@/lib/zod", never from "zod", in code that can reach the client.
 */
if (typeof window !== "undefined") z.config({ jitless: true });

export { z };
