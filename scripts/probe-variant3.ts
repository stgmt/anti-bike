/**
 * Вариант 3: список готового собирается из окна, а не из всего репозитория.
 *
 * Замер только что показал: 40 строк общего инвентаря — 0,097; узкий список с
 * нужной подсистемой — 0,94. Значит вопрос не в сборке, а в отборе: какие
 * механизмы вообще относятся к делу.
 *
 * Отбор берём из самого окна: агент называет готовые механизмы вслух
 * (providerPrepareDiagnostics — 15 раз). Проверяем кодом, какие из названных
 * действительно объявлены в репозитории. Это бесплатно и за миллисекунды.
 */
import { readFileSync } from "node:fs";
import { classify } from "../src/classify.ts";
import { retryTransient } from "../src/retry.ts";
import { findDeclarations } from "../src/exists.ts";

const KEY_FILE = "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";
const key = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"))![0];
const window = readFileSync("bench/case-tokenplan-effort-probe.txt", "utf8");
const REPO = "E:/repos/agent-teams-ai";

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

// 1. Идентификаторы, которые окно называет: camelCase и PascalCase.
const candidates = [...new Set(window.match(/\b[A-Z][a-zA-Z]{4,}(?:[A-Z][a-zA-Z]+)*\b/g) ?? [])];
console.log(`окно назвало различных имён: ${candidates.length}`);

// 2. Какие из них объявлены в репозитории — это и есть готовое.
const started = Date.now();
const { found } = await findDeclarations(candidates, { roots: [REPO] });
console.log(`объявлено в репозитории: ${found.length}  (${Date.now() - started} мс)`);

const byFile = new Map<string, string[]>();
for (const item of found) {
  const file = item.where.split("\\").join("/").split("/").slice(-2).join("/");
  const list = byFile.get(file) ?? [];
  list.push(item.name);
  byFile.set(file, list);
}
const ready = ["Что уже есть в проекте (объявлено в коде, названо в работе):"];
for (const [file, names] of [...byFile.entries()].sort()) ready.push(`- ${file}: ${names.join(", ")}`);
const text = ready.join("\n");
console.log(`список: ${text.length} знаков, файлов ${byFile.size}\n${text.slice(0, 500)}\n`);

for (let i = 1; i <= 3; i += 1) {
  const v = await retryTransient(() => classify(summary, text, { apiKey: key }), {
    attempts: 5, delayMs: 2_000,
  });
  console.log(`  прогон ${i}: ${v.score.toFixed(3)}  ${v.bike ? "ВЕЛОСИПЕД" : "чисто"}`);
}
