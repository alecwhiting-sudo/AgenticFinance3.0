import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "./generate.js";
import { extendV2 } from "./extend.js";
import { render } from "./render.js";
import { formats } from "./formats.js";
import { validate } from "./validate.js";

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db/seed");
const cmd = process.argv[2];

if (cmd === "generate") {
  const seed = Number(process.argv[3] ?? 20261001);
  // v1 (Apr–Sep, byte-stable) + the v2 Jan–Mar extension (own RNG streams)
  const dataset = extendV2(generate(seed), seed);
  mkdirSync(path.join(seedDir, "generated"), { recursive: true });
  writeFileSync(
    path.join(seedDir, "generated/dataset.json"),
    JSON.stringify(dataset, null, 1),
  );
  console.log("generated dataset:", JSON.stringify(dataset.stats));
} else if (cmd === "render") {
  // --missing renders only documents not yet on disk (v2 additions) so the
  // committed v1 binaries never churn
  await render(seedDir, { onlyMissing: process.argv[3] === "--missing" });
} else if (cmd === "formats") {
  await formats(seedDir);
} else if (cmd === "validate") {
  const errors = validate(seedDir, process.argv[3] !== "--no-files");
  for (const e of errors) console.error(" ✗", e);
  if (errors.length) process.exit(1);
} else if (cmd === "drip") {
  // Daily drip arrives with P2P M5 (plans/P2P.md): it will append fresh chains
  // and queue capture work items. Stub until the ERP intake exists.
  console.log("drip: not yet wired — lands with P2P milestone M5");
} else {
  console.error("usage: cli.ts <generate [seed] | render | formats | validate [--no-files] | drip>");
  process.exit(1);
}
