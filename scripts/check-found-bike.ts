/** Проверяет найденный руками велосипед: видит ли его гейт. */
import { findDeclarations } from "../src/exists.ts";

const names = ["atomicFile", "fileLock", "boardLock", "writeFileAtomic", "sleepSync", "getRenameRetryDelayMs"];
const r = await findDeclarations(names, { roots: ["E:/repos/agent-teams-ai/agent-teams-controller/src"] });
console.log("найдено в пакете:", r.found.map((f) => `${f.name}@${f.where.split(/[\/]/).pop()}`).join(", ") || "—");

// Готовое: встроенное в Node и в node_modules.
console.log("\nчто умеет Node без библиотек:");
console.log("  fs.promises.rename — атомарная замена на том же диске");
console.log("  fs.writeFileSync + fsync — запись с подтверждением");
console.log("  node:fs writeFile с флагом 'wx' — создание без перезаписи");

const dep = await findDeclarations(["writeFileAtomic", "proper-lockfile", "lockfile"], {
  roots: ["E:/repos/agent-teams-ai/agent-teams-controller/node_modules"],
});
console.log("\nв node_modules:", dep.found.length > 0 ? dep.found.map((f) => f.name).join(", ") : "не смотрел (нет объявления)");
