/** Существование на настоящих TypeScript-объявлениях. */
import { findDeclarations } from "../src/exists.ts";

const started = Date.now();
const r = await findDeclarations(["AuthSessionSyncEvent", "publishAuthSessionEvent", "НетТакого"], {
  roots: ["E:/repos/tokenplan/gateway/web/src"],
});
console.log(`за ${Date.now() - started} мс, найдено ${r.found.length}:`);
for (const item of r.found) console.log(`  ${item.name} — ${item.where}:${item.line} (${item.kind})`);
const missing = ["AuthSessionSyncEvent", "publishAuthSessionEvent", "НетТакого"].filter(
  (n) => !r.found.some((f) => f.name === n),
);
console.log(`нет: ${missing.join(", ") || "—"}`);
