/**
 * Разброс одной модели: пять прогонов на позитиве и контроле.
 *
 * Прошлый замер дал у gpt-oss-120b сначала зазор 0,717, потом −0,186 и имя
 * случая 2 из 3. Один замер на модель ничего не решает: здесь видно, это
 * нестабильность модели или разные ответы на разные окна.
 *
 * Запуск: node --experimental-strip-types scripts/variance.ts <модель>
 */

import { readFileSync, writeFileSync } from "node:fs";

import { classify } from "../src/classify.ts";

const KEY_FILE =
  "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";
const INSTRUCTION = readFileSync("/tmp/instr2.txt", "utf8");

const READY = `Что уже есть в проекте carousel-demo: langgraph 1.2.12 с StateGraph(state_schema,
context_schema=…), Runtime с context/store/stream_writer/previous, AsyncSqliteSaver, Command,
interrupt; pydantic 2.13.5; порты typing.Protocol в carousel/ports.py; Pydantic-схема на каждый
контракт; шаг calls/ с кешем платных вызовов; бюджет прогона.`;

const RUNS = 5;

function apiKey(): string {
  const match = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"));
  if (!match) throw new Error("ключ не найден");
  return match[0];
}

async function summarize(key: string, model: string, input: string, ceiling: number): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
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
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  return payload.choices?.[0]?.message?.content ?? "";
}

async function main(): Promise<void> {
  const model = process.argv[2] ?? "openai/gpt-oss-120b";
  const key = apiKey();
  const positive = readFileSync("bench/agent-args.txt", "utf8");
  const control = readFileSync("bench/agent-ctl.txt", "utf8");

  console.log(`${model}, ${RUNS} прогонов на каждом окне\n`);
  for (const [label, input] of [["позитив", positive], ["контроль", control]] as [string, string][]) {
    const scores: number[] = [];
    for (let run = 1; run <= RUNS; run += 1) {
      const text = await summarize(key, model, input, 4000);
      if (text.trim() === "") {
        console.log(`  ${label} ${run}: пусто`);
        continue;
      }
      const verdict = await classify(text, READY, { apiKey: key });
      const named = text.includes("RunContext");
      scores.push(verdict.score);
      console.log(
        `  ${label} ${run}: ${verdict.score.toFixed(3)}  ${String(text.length).padStart(5)} зн.  `
        + `случай назван: ${named ? "да" : "нет"}`,
      );
      writeFileSync(`bench/var-${label}-${run}.txt`, text, "utf8");
    }
    if (scores.length > 0) {
      const lo = Math.min(...scores);
      const hi = Math.max(...scores);
      console.log(`  → ${lo.toFixed(3)}–${hi.toFixed(3)}, разброс ${(hi - lo).toFixed(3)}\n`);
    }
  }
}

await main();
