/**
 * Вариант 3б: отбор по окну + описание задач.
 *
 * Замеры на этом же окне:
 *   имена, объявленные в репо, без описаний        0,049
 *   общий инвентарь репозитория, 40 строк          0,097
 *   узкий список с описанием задач (ручной)        0,94
 *
 * Проверяем, можно ли получить узкий список с описаниями автоматически:
 * окно называет подсистему, модель читает её код и описывает задачи.
 */
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { classify } from "../src/classify.ts";
import { retryTransient } from "../src/retry.ts";

const run = promisify(execFile);
const KEY_FILE = "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";
const key = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"))![0];
const REPO = "E:/repos/agent-teams-ai";

const summary = `ВМЕСТО ГОТОВОГО — главное.
предложений вместо готового нет.

СОЗДАЛ НОВОЕ
src/main/services/team/provisioning/TeamProvisioningAnthropicEffortProbe.ts

ЗАПИСАЛ
Добавил createAnthropicEffortProbe: отдельный вызов CLI, чтобы проверить, поддерживает ли
выбранная модель effort. Подключил в TeamProvisioningProviderPreflight через deps.execCli.
Добавил кэширование асинхронных проверок effort и вставку CLI-зонда перед сообщениями об
ошибках. Расширил teamEffortOptions: показать варианты effort для моделей со статусом
unverified-catalog-missing.`;

/** Код подсистемы, которую называет окно. */
const { stdout: source } = await run("rg", [
  "-l", "-e", "providerPrepareDiagnostics", "-e", "resolveAnthropicEffortSupport",
  "-e", "launchAuthorityBlockers", "-e", "createLaunchGuard",
  "-g", "*.ts", "-g", "*.tsx", "-g", "!node_modules", "-g", "!*test*", "src",
], { cwd: REPO, maxBuffer: 32 * 1024 * 1024 });

const files = source.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 12);
console.log(`файлов подсистемы: ${files.length}`);

const chunks: string[] = [];
for (const file of files) {
  try {
    chunks.push(`--- ${file} ---\n${readFileSync(`${REPO}/${file}`, "utf8").slice(0, 4000)}`);
  } catch { continue; }
}
const code = chunks.join("\n\n").slice(0, 60_000);
console.log(`кода на вход: ${code.length} знаков`);

const INSTRUCTION = `Ты описываешь, что уже умеет подсистема проекта.

Вход — код. Напиши список: какие задачи эта подсистема уже закрывает. Одна строка =
один механизм: «<название> — <какую задачу закрывает, каким способом>».

Пиши только то, что видно в коде. Не больше 15 строк. По-русски.`;

const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "qwen/qwen3.7-flash",
    messages: [{ role: "system", content: INSTRUCTION }, { role: "user", content: code }],
    max_tokens: 12_000, temperature: 0,
  }),
  signal: AbortSignal.timeout(240_000),
});
const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
const described = payload.choices?.[0]?.message?.content ?? "";
writeFileSync("bench/app-focused.txt", described, "utf8");
console.log(`\n--- список ---\n${described}\n`);

for (let i = 1; i <= 3; i += 1) {
  const v = await retryTransient(() => classify(summary, `Что уже есть в проекте:\n${described}`, { apiKey: key }), {
    attempts: 5, delayMs: 2_000,
  });
  console.log(`  прогон ${i}: ${v.score.toFixed(3)}  ${v.bike ? "ВЕЛОСИПЕД" : "чисто"}`);
}
