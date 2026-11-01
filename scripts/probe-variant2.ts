/**
 * Проба варианта 2: поднимается ли оценка на окне tokenplan.
 *
 * Список готового собран моделью из кода (bench/app-capabilities.txt).
 * Сравниваем с тем, что было: оценка 0,09–0,20 при ручном списке.
 *
 * Порог решения: 0,5. Ниже — вариант не строим.
 */
import { readFileSync } from "node:fs";
import { classify } from "../src/classify.ts";
import { retryTransient } from "../src/retry.ts";

const KEY_FILE = "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";
const key = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"))![0];

const summary = `ВМЕСТО ГОТОВОГО — главное.
предложений вместо готового нет.

СОЗДАЛ НОВОЕ
src/main/services/team/provisioning/TeamProvisioningAnthropicEffortProbe.ts

ЗАПИСАЛ
Добавил модуль createAnthropicEffortProbe с вызовом CLI для проверки effort; подключил
его в preflight через deps.execCli; закэшировал асинхронные проверки effort; расширил
отображение вариантов effort для моделей со статусом unverified-catalog-missing.`;

const built = readFileSync("bench/app-capabilities.txt", "utf8");
const VARIANTS: [string, string][] = [
  ["пусто", ""],
  ["список от модели (вариант 2)", `Что уже есть в проекте:\n${built}`],
];

let retries = 0;
for (const [label, ready] of VARIANTS) {
  console.log(`\n=== ${label} (${ready.length} знаков) ===`);
  for (let i = 1; i <= 3; i += 1) {
    const started = Date.now();
    try {
      const v = await retryTransient(() => classify(summary, ready, { apiKey: key }), {
        attempts: 5, delayMs: 2_000,
        onRetry: (n) => { retries += 1; console.log(`    повтор ${n} (429)`); },
      });
      console.log(`  прогон ${i}: ${v.score.toFixed(3)}  ${v.bike ? "ВЕЛОСИПЕД" : "чисто"}  ${Date.now() - started} мс`);
    } catch (e) {
      console.log(`  прогон ${i}: ОШИБКА ${String(e).slice(0, 90)}`);
    }
  }
}
console.log(`\nповторов на 429: ${retries}`);
