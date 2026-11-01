/**
 * Лечится ли пустой ответ дешёвых моделей потолком токенов.
 *
 * Прошлые опыты: qwen, ling, glm, gpt-5-nano возвращали пустой текст, и всё
 * рассуждение уходило в reasoning. Гипотеза: потолок 1500 токенов съедается
 * рассуждением до начала ответа. Проверяется поднятием потолка до 4000.
 *
 * Запуск: node --experimental-strip-types scripts/token-ceiling.ts
 */

import { readFileSync } from "node:fs";

const KEY_FILE =
  "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const INSTRUCTION = readFileSync("/tmp/instr.txt", "utf8");

const MODELS = ["qwen/qwen3.7-flash", "inclusionai/ling-3.0-flash", "z-ai/glm-5.3-flash", "openai/gpt-5-nano"];
const CEILINGS = [1500, 4000, 8000];

function apiKey(): string {
  const match = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"));
  if (!match) throw new Error("ключ не найден");
  return match[1] ?? match[0];
}

async function probe(key: string, model: string, maxTokens: number, input: string): Promise<string> {
  const started = performance.now();
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: INSTRUCTION },
        { role: "user", content: input },
      ],
      max_tokens: maxTokens,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const ms = Math.round(performance.now() - started);
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string; reasoning?: string }; finish_reason?: string }[];
    usage?: { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
    error?: { message?: string };
  };
  const text = payload.choices?.[0]?.message?.content ?? "";
  const reason = payload.choices?.[0]?.message?.reasoning ?? "";
  const finish = payload.choices?.[0]?.finish_reason ?? "?";
  const used = payload.usage?.completion_tokens ?? 0;
  const usedReason = payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const state = text.trim() === "" ? "ПУСТО" : `ok ${text.length} зн.`;
  return `${state}  finish=${finish}  вышло ${used} ток. (рассуждение ${usedReason})  ${ms} мс`
    + (payload.error?.message ? `  ${payload.error.message.slice(0, 50)}` : "")
    + (text.trim() === "" && reason.length > 0 ? `  reasoning ${reason.length} зн.` : "");
}

async function main(): Promise<void> {
  const key = apiKey();
  const input = readFileSync("bench/agent-args.txt", "utf8");
  console.log(`вход ${input.length.toLocaleString("ru")} знаков\n`);
  for (const model of MODELS) {
    console.log(model);
    for (const ceiling of CEILINGS) {
      const line = await probe(key, model, ceiling, input);
      console.log(`  потолок ${String(ceiling).padStart(5)}: ${line}`);
    }
  }
}

await main();
