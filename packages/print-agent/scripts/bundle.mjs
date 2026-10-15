// Bundles the agent into ONE file (dist/print-agent.cjs): the PC needs only Node, no node_modules.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
await build({
  entryPoints: [path.join(root, "src/cli.ts")],
  outfile: path.join(root, "dist/print-agent.cjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "info",
});
