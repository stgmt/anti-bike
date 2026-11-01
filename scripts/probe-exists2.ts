/** Проверка существования: языки и несуществующий корень. */
import { existsSync } from "node:fs";
import { findDeclarations } from "../src/exists.ts";

const ts = await findDeclarations(["TeamProvisioningProviderPreflight", "createAnthropicEffortProbe"], {
  roots: ["E:/repos/tokenplan"],
});
console.log(`tokenplan (весь репо):`);
for (const item of ts.found) console.log(`  есть ${item.name} — ${item.where}:${item.line} (${item.kind})`);
if (ts.found.length === 0) console.log("  не найдено");
console.log(`  файл ts в репо есть: ${existsSync("E:/repos/tokenplan/gateway/web/src/lib/auth-session-sync.ts")}`);

const bad = await findDeclarations(["Anything"], { roots: ["E:/repos/tokenplan/src"] });
console.log(`\nнесуществующий корень: найдено ${bad.found.length}, нет каталога: ${bad.missingRoots.join(", ") || "—"}`);

const mixed = await findDeclarations(["Anything"], { roots: ["E:/repos/tokenplan/src", "E:/repos/tokenplan/gateway"] });
console.log(`смешанный: найдено ${mixed.found.length}, нет каталога: ${mixed.missingRoots.join(", ")}`);
