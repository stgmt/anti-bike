/** Перепроверка: не сломалась ли проверка существования на carousel-demo. */
import { findDeclarations } from "../src/exists.ts";

const names = ["FigureVerdicts", "RunContext", "Storyboard", "CardSpec"];
const started = Date.now();
const r = await findDeclarations(names, { roots: ["E:/repos/carousel-demo/carousel"] });
console.log(`carousel/: ${Date.now() - started} мс, найдено ${r.found.length} из ${names.length}`);
for (const item of r.found) console.log(`  ${item.name} — ${item.where}:${item.line} (${item.kind})`);
const absent = names.filter((n) => !r.found.some((f) => f.name === n));
console.log(`нет: ${absent.join(", ") || "—"}`);
