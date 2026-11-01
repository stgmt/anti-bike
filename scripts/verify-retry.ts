/**
 * Проверка повтора на живом окне.
 *
 * Что проверяется:
 *   окно tokenplan проходит сводку и не теряет его на 429;
 *   повтор при пустом ответе уходит с потолком 12 000;
 *   затраченное время и число попыток видны в выводе.
 *
 * Запуск: node --experimental-strip-types scripts/verify-retry.ts
 */

import { readFileSync } from "node:fs";

import { RETRY_MAX_TOKENS, summarize } from "../src/summarize.ts";

const KEY_FILE =
  "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";

function apiKey(): string {
  const match = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"));
  if (!match) throw new Error("ключ не найден");
  return match[0];
}

const windowText = readFileSync("bench/case-tokenplan-effort-probe.txt", "utf8");
let retries = 0;
const started = Date.now();
const summary = await summarize(windowText, {
  apiKey: apiKey(),
  attempts: 3,
  onRetry: (attempt, error) => {
    retries += 1;
    console.log(`  повтор ${attempt}: ${String(error).slice(0, 80)}`);
  },
});
const ms = Date.now() - started;

console.log(`окно ${windowText.length} знаков`);
console.log(`пусто: ${summary.empty}  повторов: ${retries}  ${ms} мс`);
console.log(`сжатие: ${summary.inputChars} → ${summary.outputChars} знаков`);
console.log(`потолок повтора: ${RETRY_MAX_TOKENS}`);
if (summary.empty) console.log(`  причина: ${summary.note}`);
else {
  const head = summary.text.split("СОЗДАЛ НОВОЕ")[0].trim().split("\n").slice(0, 4);
  console.log(`сводка:\n${head.map((line) => `  ${line}`).join("\n")}`);
}
