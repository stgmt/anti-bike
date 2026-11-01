/**
 * Почему модель не ответила: потолок, ошибка провайдера или пустой content.
 *
 * Прошлый прогон показал «нет ответов» без причины. Здесь печатается конверт
 * целиком по полям, которые решают: finish_reason, токены, рассуждение, ошибка.
 *
 * Запуск: node --experimental-strip-types scripts/why-empty.ts <модель> [окно]
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
  const model = process.argv[2];
  const input = readFileSync(process.argv[3] ?? "bench/agent-args.txt", "utf8");
  for (const ceiling of [16000, 24000]) {
    const started = performance.now();
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: INSTRUCTION },
          { role: "user", content: input },
        ],
        max_tokens: ceiling,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const ms = Math.round(performance.now() - started);
    const text = await response.text();
    let payload: {
      error?: { message?: string; code?: number };
      choices?: { message?: { content?: string; reasoning?: string }; finish_reason?: string }[];
      usage?: { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
    };
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      console.log(`потолок ${ceiling}: не JSON, ${text.slice(0, 150)}`);
      continue;
    }
    const message = payload.choices?.[0]?.message;
    const content = message?.content ?? "";
    const reason = message?.reasoning ?? "";
    console.log(
      `потолок ${String(ceiling).padStart(5)}: HTTP ${response.status}  `
      + `finish=${payload.choices?.[0]?.finish_reason ?? "?"}  `
      + `вышло ${payload.usage?.completion_tokens ?? 0} ток. `
      + `(рассуждение ${payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0})  `
      + `content ${content.length} зн., reasoning ${reason.length} зн.  ${ms} мс`,
    );
    if (payload.error?.message) console.log(`         ошибка: ${payload.error.message.slice(0, 160)}`);
    if (content.trim() !== "") console.log(`         начало: ${content.replace(/\s+/g, " ").slice(0, 140)}`);
  }
}

await main();
