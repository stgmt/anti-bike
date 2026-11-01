/**
 * Разбор причины: длина списка или попадание в подсистему.
 *
 * 2г — полный список от модели, но обрезанный до 700 знаков (первые строки).
 *      Если оценка поднимется — дело в длине.
 * 2д — узкий список БЕЗ слов effort/preflight/catalog: только общие слова
 *      про provisioning. Если упадёт — дело в попадании, а не в длине.
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
Добавил createAnthropicEffortProbe: отдельный вызов CLI, чтобы проверить, поддерживает ли
выбранная модель effort. Подключил в TeamProvisioningProviderPreflight через deps.execCli,
вместо инлайн-кода. Добавил кэширование асинхронных проверок effort и вставку CLI-зонда
перед формированием сообщений об ошибках. Расширил teamEffortOptions: показать варианты
effort для моделей со статусом unverified-catalog-missing.
Проблема на скриншоте остаётся: интерфейс считает Terra недоступной, статус провайдера
не подтверждён, отдельная диагностика запускает модель по умолчанию.`;

const full = readFileSync("bench/app-capabilities.txt", "utf8");
const short = full.split("\n").slice(0, 6).join("\n");

const noKeywords = `Что уже есть в проекте agent-teams-ai:
- Слой подготовки команды: проверки перед стартом, права на старт, охрана старта,
  диагностика готовности.
- Список моделей и их параметры.
- Выбор модели команды в интерфейсе.
- Проверка доступности модели.
- Старт команды идёт через слой подготовки.`;

const VARIANTS: [string, string][] = [
  [`2г: полный список, первые 6 строк (${short.length})`, `Что уже есть в проекте:\n${short}`],
  [`2д: узкий БЕЗ слов effort/preflight (${noKeywords.length})`, noKeywords],
];

for (const [label, ready] of VARIANTS) {
  console.log(`\n=== ${label} ===`);
  console.log(ready.split("\n").slice(0, 3).join("\n").slice(0, 200));
  for (let i = 1; i <= 2; i += 1) {
    const v = await retryTransient(() => classify(summary, ready, { apiKey: key }), {
      attempts: 5, delayMs: 2_000,
    });
    console.log(`  ${i}: ${v.score.toFixed(3)}  ${v.bike ? "ВЕЛОСИПЕД" : "чисто"}`);
  }
}
