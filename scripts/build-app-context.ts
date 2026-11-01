/**
 * Вариант 2: список готового собирает модель, читая код репозитория.
 *
 * Проба на настоящем окне, где велосипед был, а гейт молчал.
 *
 * Всё приложение целиком (3973 файла, 49 МБ) в один вызов не влезает. Поэтому
 * на вход идёт выжимка: объявления по подсистемам, без тел. Вопрос к модели —
 * не «что здесь есть», а «что из этого закрывает какую задачу»: замер прошлой
 * ветки показал, что модель сравнивает понятия, а имена сами по себе дают 0,03.
 *
 * Запуск: node --experimental-strip-types scripts/build-app-context.ts [репо]
 */

import { execFile } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const REPO = process.argv[2] ?? "E:/repos/agent-teams-ai";

const KEY_FILE = "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";
const MODEL = "qwen/qwen3.7-flash";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** Объявления по подсистемам: имя и первая строка описания. */
async function declarationDigest(): Promise<string> {
  const { stdout } = await run("rg", [
    "-n", "--no-heading", "-H",
    "-e", "^export (async )?(function|class|const|interface|type) ",
    "-g", "*.ts", "-g", "*.tsx",
    "-g", "!node_modules", "-g", "!*test*", "-g", "!*__tests__*",
    "src",
  ], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 });

  const byDir = new Map<string, string[]>();
  for (const raw of stdout.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const match = /^(.*?):(\d+):(.*)$/.exec(line);
    if (!match) continue;
    const [, file, , body] = match;
    const name = /^export (?:async )?(?:function|class|const|interface|type) (\w+)/.exec(body.trim())?.[1];
    if (!name) continue;
    const dir = file.split("\\").join("/").split("/").slice(0, 4).join("/");
    const bucket = byDir.get(dir) ?? [];
    if (!bucket.includes(name)) bucket.push(name);
    byDir.set(dir, bucket);
  }

  const lines: string[] = [];
  for (const [dir, names] of [...byDir.entries()].sort()) {
    lines.push(`${dir}: ${names.join(", ")}`);
  }
  return lines.join("\n");
}

function apiKey(): string {
  const match = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"));
  if (!match) throw new Error("ключ не найден");
  return match[0];
}

const INSTRUCTION = `Ты описываешь возможности проекта для проверки: не изобрёл ли агент
своё вместо готового. Вход — объявления кода по подсистемам.

Напиши короткий список: что в этом проекте уже умеет делать свой код и установленные
библиотеки. Не перечисляй имена подряд — называй задачу, которую механизм закрывает.
Одна строка = один механизм: «<название> — <какую задачу закрывает>».

Пиши только то, что видно из объявлений и названий подсистем. Не додумывай.
Не больше 40 строк. По-русски.`;

async function main(): Promise<void> {
  const digest = await declarationDigest();
  console.log(`выжимка: ${digest.length} знаков`);
  writeFileSync("bench/app-digest.txt", digest, "utf8");

  const started = Date.now();
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: INSTRUCTION },
        { role: "user", content: digest },
      ],
      max_tokens: 12_000,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(240_000),
  });
  const ms = Date.now() - started;
  if (!response.ok) throw new Error(`${response.status}: ${(await response.text()).slice(0, 200)}`);

  const payload = await response.json() as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
  };
  const text = payload.choices?.[0]?.message?.content ?? "";
  const finish = payload.choices?.[0]?.finish_reason ?? "?";
  writeFileSync("bench/app-capabilities.txt", text, "utf8");

  console.log(`ответ: ${text.length} знаков, finish=${finish}, ${ms} мс`);
  console.log(`токены: вход ${payload.usage?.prompt_tokens ?? "?"}, выход ${payload.usage?.completion_tokens ?? "?"}`);
  console.log(`\n--- список ---\n${text}`);
}

await main();
