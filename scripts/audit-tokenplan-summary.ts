/** Что сводка окна tokenplan назвала из имён, которые агент создал. */
import { readFileSync } from "node:fs";
const s = readFileSync("bench/summary-tokenplan.txt", "utf8");
const claimed = ["createAnthropicEffortProbe", "recordAnthropicEffortOutcome", "probeAnthropicEffort", "effortProbes", "TeamProvisioningAnthropicEffortProbe"];
console.log(`сводка ${s.length} знаков`);
for (const name of claimed) console.log(`  ${name}: ${s.includes(name) ? "назван" : "ПОТЕРЯН"}`);
