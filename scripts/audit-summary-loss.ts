/**
 * Что сводка теряет: имена, созданные в окне, против имён в сводке.
 *
 * Вопрос: виноват ли сжатие, или агент просто не сказал, что делает своё.
 */
import { readFileSync } from "node:fs";

const text = readFileSync("bench/case-tokenplan-effort-probe.txt", "utf8");
const claimed = ["createAnthropicEffortProbe", "recordAnthropicEffortOutcome", "probeAnthropicEffort", "effortProbes", "TeamProvisioningAnthropicEffortProbe"];

console.log("Названо агентом в окне:");
for (const name of claimed) {
  const n = text.split(name).length - 1;
  console.log(`  ${name}: ${n} раз`);
}

// Что есть в сохранённой сводке этого окна?
const journal = readFileSync("bench/detect2-journal.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sum = journal.find((r: any) => (r.summary ?? "").includes("AnthropicEffortProbe"));
console.log(`\nВ сводке: ${sum ? "назван " + (sum.summary.match(/[A-Za-z]*Effort[A-Za-z]*/g) ?? []).join(", ") : "сводки нет"}`);
console.log(`\nСлов с «вместо» в окне: ${text.split("вместо").length - 1}`);
console.log(`Слов «замен»: ${text.split("замен").length - 1}`);
