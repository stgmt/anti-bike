/**
 * Проверка победителей отбора не только по оценке, но и глазами.
 *
 * Прошлый скрин пропустил модель-петлю: зазор 0,959, а в сводке «graph.invoke»
 * повторён тридцать раз. Оценка классификатора такое не ловит. Здесь три
 * признака, каждый считается по тексту сводки:
 *   петля — доля строк, повторяющих предыдущую;
 *   сжатие — доля от входа (петля и копия входа её раздувают);
 *   имя случая — назван ли RunContext и как.
 *
 * Запуск: node --experimental-strip-types scripts/final-check.ts
 */

import { readFileSync, writeFileSync } from "node:fs";

import { classify } from "../src/classify.ts";

const KEY_FILE =
  "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const INSTRUCTION = readFileSync("/tmp/instr2.txt", "utf8");

const READY = `Что уже есть в проекте carousel-demo: langgraph 1.2.12 с StateGraph(state_schema,
context_schema=…), Runtime с context/store/stream_writer/previous, AsyncSqliteSaver, Command,
interrupt; pydantic 2.13.5; порты typing.Protocol в carousel/ports.py; Pydantic-схема на каждый
контракт; шаг calls/ с кешем платных вызовов; бюджет прогона.`;

const MODELS = [
  "qwen/qwen3.7-flash",
  "qwen/qwen3.8-flash",
  "openai/gpt-oss-120b",
];
const RUNS = 3;

function apiKey(): string {
  const match = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"));
  if (!match) throw new Error("ключ не найден");
  return match[0];
}

/** Доля строк, повторяющих строку выше. */
function loopShare(text: string): number {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  if (lines.length < 4) return 0;
  let repeats = 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === lines[index - 1]) repeats += 1;
  }
  return repeats / (lines.length - 1);
}

async function summarize(key: string, model: string, input: string): Promise<{ text: string; ms: number; cost: number }> {
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
      max_tokens: 4000,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const ms = Math.round(performance.now() - started);
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number };
  };
  return { text: payload.choices?.[0]?.message?.content ?? "", ms, cost: payload.usage?.cost ?? 0 };
}

async function main(): Promise<void> {
  const key = apiKey();
  const positive = readFileSync("bench/agent-args.txt", "utf8");
  const control = readFileSync("bench/agent-ctl.txt", "utf8");

  console.log("Проверка глазами: петля, сжатие, имя случая\n");
  for (const model of MODELS) {
    const scores: number[] = [];
    const controls: number[] = [];
    let loops = 0;
    let compression = 0;
    let names = 0;
    let ms = 0;
    let cost = 0;
    let sample = "";
    for (let run = 0; run < RUNS; run += 1) {
      const row = await summarize(key, model, positive);
      if (row.text.trim() === "") continue;
      ms += row.ms;
      cost += row.cost;
      const verdict = await classify(row.text, READY, { apiKey: key });
      scores.push(verdict.score);
      loops += loopShare(row.text);
      compression += row.text.length / positive.length;
      if (row.text.includes("RunContext")) names += 1;
      if (sample === "") sample = row.text;

      const ctl = await summarize(key, model, control);
      if (ctl.text.trim() !== "") {
        controls.push((await classify(ctl.text, READY, { apiKey: key })).score);
      }
    }
    if (scores.length === 0) {
      console.log(`${model.padEnd(36)} нет ответов`);
      continue;
    }
    const n = scores.length;
    const margin = Math.min(...scores) - Math.max(...controls.length > 0 ? controls : [0]);
    const loopAvg = loops / n;
    const ratioAvg = compression / n;
    const verdict =
      margin >= 0.4 && Math.min(...scores) >= 0.6 && loopAvg < 0.25 && ratioAvg < 0.4 && names === n
        ? "годна"
        : "нет  ";
    writeFileSync(`bench/final-${model.replace(/[/:]/g, "_")}.txt`, sample, "utf8");
    console.log(
      `${verdict} ${model.padEnd(36)} зазор ${margin.toFixed(3)}  петля ${(loopAvg * 100).toFixed(0).padStart(3)}%  `
      + `сжатие ${(ratioAvg * 100).toFixed(0).padStart(3)}%  имя ${names}/${n}  `
      + `${Math.round(ms / n)} мс  $${(cost / n).toFixed(5)}`,
    );
  }
}

await main();
