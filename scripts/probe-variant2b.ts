/**
 * Вариант 2б: тот же список от модели, но целиком (40 строк, 4,5 тыс. знаков),
 * и вариант 2в: список на полторы тысячи знаков из подсистем, близких к окну.
 *
 * Проверяем гипотезу: провал 0,194 — от длины списка, а не от способа сбора.
 */
import { readFileSync } from "node:fs";
import { classify } from "../src/classify.ts";
import { retryTransient } from "../src/retry.ts";

const KEY_FILE = "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";
const key = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"))![0];

// Сводка — та, что гейт делает, но полнее: с уже готовыми механизмами из окна.
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
const focused = `Что уже есть в проекте agent-teams-ai:
- Слой provisioning команды: preflight-проверки перед запуском, права запуска,
  guard на запуск (createLaunchGuard, launchAuthorityBlockers), диагностика подготовки
  провайдера (providerPrepareDiagnostics).
- Каталог моделей и статус провайдера: каталог отдаёт список моделей и их параметры,
  включая effort; статус считается подтверждённым, если его прислал провайдер.
- Выбор модели команды в интерфейсе: TeamModelSelector с resolveTeamModelSelectorValue.
- Проверка доступности модели и опций effort: teamModelAvailability, teamEffortOptions
  с resolveAnthropicEffortSupport.
- Запуск команды идёт через слой provisioning: preflight, права, guard, журнал.`;

const VARIANTS: [string, string][] = [
  ["2б: полный список от модели", `Что уже есть в проекте:\n${full}`],
  ["2в: узкий список (1,5 тыс.)", focused],
];

for (const [label, ready] of VARIANTS) {
  console.log(`\n=== ${label} (${ready.length} знаков) ===`);
  for (let i = 1; i <= 3; i += 1) {
    const v = await retryTransient(() => classify(summary, ready, { apiKey: key }), {
      attempts: 5, delayMs: 2_000,
      onRetry: (n) => console.log(`    повтор ${n}`),
    });
    console.log(`  ${i}: ${v.score.toFixed(3)}  ${v.bike ? "ВЕЛОСИПЕД" : "чисто"}`);
  }
}
