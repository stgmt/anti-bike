/**
 * Делать сводку готовой моделью или своим вызовом дешёвой.
 *
 * Вход один — ответы агента с параметрами вызовов (тот набор, который поймал
 * случай). Сравниваются две вещи: специальный суммаризатор ScaleDown и обычные
 * дешёвые модели с той же инструкцией. Ответ сводки идёт в классификатор,
 * главный вопрос — сохранила ли сводка предложение.
 *
 * Запуск: node --experimental-strip-types scripts/summarize-choice.ts
 */

import { readFileSync, writeFileSync } from "node:fs";

import { classify } from "../src/classify.ts";

const KEY_FILE =
  "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const READY = `Что уже есть в проекте carousel-demo: langgraph 1.2.12 с StateGraph(state_schema,
context_schema=…), Runtime с context/store/stream_writer/previous, AsyncSqliteSaver, Command,
interrupt; pydantic 2.13.5; порты typing.Protocol в carousel/ports.py; Pydantic-схема на каждый
контракт; шаг calls/ с кешем платных вызовов; бюджет прогона.`;

const INSTRUCTION = `Ты сжимаешь протокол работы агента-программиста. Вход — только то, что агент
сказал сам и чем вызвал инструменты.

Пиши по-русски, списком. Сохрани:
- какие сущности, классы и слои агент предлагал СОЗДАТЬ (названия дословно);
- какие файлы он записал и что в них нового;
- что он предлагал владельцу и какими словами.

Не пересказывай прочитанные файлы и вывод команд. Не оценивай качество работы.
Если агент предлагал своё вместо готового механизма библиотеки — назови это прямо:
«предложил своё вместо <библиотека.механизм>».`;

const MODELS = [
  "scaledown/summarize",
  "inclusionai/ling-3.0-flash",
  "qwen/qwen3.7-flash",
  "openai/gpt-oss-120b",
];

function apiKey(): string {
  const match = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"));
  if (!match) throw new Error("ключ не найден");
  return match[0];
}

interface Row {
  model: string;
  ok: boolean;
  ms: number;
  cost: number;
  chars: number;
  text: string;
  note: string;
}

async function summarize(key: string, model: string, input: string): Promise<Row> {
  const started = performance.now();
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: INSTRUCTION },
          { role: "user", content: input },
        ],
        max_tokens: 1200,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const ms = Math.round(performance.now() - started);
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string; reasoning?: string } }[];
      usage?: { cost?: number };
      error?: { message?: string };
    };
    const text = payload.choices?.[0]?.message?.content ?? "";
    const reason = payload.choices?.[0]?.message?.reasoning ?? "";
    return {
      model,
      ok: text.trim() !== "",
      ms,
      cost: payload.usage?.cost ?? 0,
      chars: text.length,
      text,
      note: text.trim() === "" ? `пусто; рассуждение ${reason.length} зн. ${payload.error?.message?.slice(0, 60) ?? ""}` : "",
    };
  } catch (error) {
    return { model, ok: false, ms: Math.round(performance.now() - started), cost: 0, chars: 0, text: "", note: String(error).slice(0, 120) };
  }
}

async function main(): Promise<void> {
  const key = apiKey();
  const input = readFileSync("bench/agent-args.txt", "utf8");
  console.log(`вход: ${input.length.toLocaleString("ru")} знаков (ответы агента + параметры вызовов)\n`);

  const rows: Row[] = [];
  for (const model of MODELS) {
    const row = await summarize(key, model, input);
    rows.push(row);
    if (!row.ok) {
      console.log(`${model.padEnd(30)} —  ${row.note}`);
      continue;
    }
    const verdict = await classify(row.text, READY, { apiKey: key });
    writeFileSync(`bench/choice-${model.replace(/[/:]/g, "_")}.txt`, row.text, "utf8");
    console.log(
      `${model.padEnd(30)} ${String(row.ms).padStart(5)} мс  ${String(row.chars).padStart(5)} зн. `
      + `(${(row.chars / input.length * 100).toFixed(1)}%)  $${row.cost.toFixed(5)}  `
      + `→ ${verdict.score.toFixed(3)} ${verdict.bike ? "велосипед" : "чисто"}`,
    );
  }

  const kept = rows.filter((row) => row.ok);
  console.log("\nчто сохранила сводка:");
  for (const row of kept) {
    const names = (row.text.match(/RunContext/g) ?? []).length;
    const instead = /вместо/i.test(row.text);
    console.log(`  ${row.model.padEnd(30)} RunContext: ${names}, говорит «вместо готового»: ${instead ? "да" : "нет"}`);
  }
}

await main();
