/**
 * Сводки победителей отбора глазами.
 *
 * Высокий зазор бывает и у модели, которая не сжимает, а повторяет вход.
 * Здесь печатается сама сводка, чтобы это увидеть.
 *
 * Запуск: node --experimental-strip-types scripts/screen-look.ts <модель> [окно]
 */

import { readFileSync } from "node:fs";

const KEY_FILE =
  "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";

const INSTRUCTION = readFileSync("/tmp/instr2.txt", "utf8");

function apiKey(): string {
  const match = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"));
  if (!match) throw new Error("ключ не найден");
  return match[0];
}

async function main(): Promise<void> {
  const model = process.argv[2] ?? "meta-llama/llama-3.1-8b-instruct";
  const input = readFileSync(process.argv[3] ?? "bench/agent-args.txt", "utf8");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: INSTRUCTION },
        { role: "user", content: input },
      ],
      max_tokens: 4000,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number };
  };
  const text = payload.choices?.[0]?.message?.content ?? "";
  console.log(`${model}: вход ${input.length} зн. → сводка ${text.length} зн. `
    + `(${(text.length / input.length * 100).toFixed(1)}%), $${(payload.usage?.cost ?? 0).toFixed(5)}\n`);
  console.log(text.slice(0, 2200));
}

await main();
