/**
 * Бенч суммаризаторов: точность, устойчивость, ложные срабатывания.
 *
 * Прошлый опыт дал один замер на одной модели и мог быть случайностью.
 * Здесь три вещи:
 *   позитив — окно со случаем, три прогона каждой модели (устойчивость);
 *   контроль — окно той же сессии без случая (ложные срабатывания);
 *   цена и задержка по каждому вызову.
 *
 * Ответ сводки идёт в классификатор. Главное — сохранила ли сводка предложение
 * и не выдумала ли его там, где его нет.
 *
 * Запуск: node --experimental-strip-types scripts/summarize-bench.ts
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
  "qwen/qwen3.7-flash",
  "inclusionai/ling-3.0-flash",
  "google/gemini-2.5-flash",
  "z-ai/glm-5.3-flash",
  "scaledown/summarize",
];
const RUNS = 3;

function apiKey(): string {
  const match = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"));
  if (!match) throw new Error("ключ не найден");
  return match[0];
}

interface Row {
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
        max_tokens: Number(process.env.MAXTOK ?? 4000),
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
      ok: text.trim() !== "",
      ms,
      cost: payload.usage?.cost ?? 0,
      chars: text.length,
      text,
      note: text.trim() === ""
        ? `пусто (рассуждение ${reason.length} зн.) ${payload.error?.message?.slice(0, 50) ?? ""}`
        : "",
    };
  } catch (error) {
    return { ok: false, ms: Math.round(performance.now() - started), cost: 0, chars: 0, text: "", note: String(error).slice(0, 90) };
  }
}

async function bench(key: string, label: string, input: string, expectBike: boolean): Promise<void> {
  console.log(`\n${label}: ${input.length.toLocaleString("ru")} знаков, ждём ${expectBike ? "велосипед" : "чисто"}`);
  for (const model of MODELS) {
    const scores: number[] = [];
    let ms = 0;
    let cost = 0;
    let chars = 0;
    let failed = 0;
    let note = "";
    let last = "";
    for (let run = 0; run < RUNS; run += 1) {
      const row = await summarize(key, model, input);
      if (!row.ok) {
        failed += 1;
        note = row.note;
        continue;
      }
      const verdict = await classify(row.text, READY, { apiKey: key });
      scores.push(verdict.score);
      ms += row.ms;
      cost += row.cost;
      chars += row.chars;
      last = row.text;
    }
    if (scores.length === 0) {
      console.log(`  ${model.padEnd(30)} все ${RUNS} прогонов пусты: ${note}`);
      continue;
    }
    const lo = Math.min(...scores);
    const hi = Math.max(...scores);
    const agree = scores.every((score) => (score >= 0.5) === expectBike);
    writeFileSync(
      `bench/bench-${label.startsWith("позитив") ? "pos" : "ctl"}-${model.replace(/[/:]/g, "_")}.txt`,
      last,
      "utf8",
    );
    console.log(
      `  ${model.padEnd(30)} ${lo.toFixed(3)}–${hi.toFixed(3)} `
      + `${agree ? "верно " : "ОШИБКА"} пустых ${failed}/${RUNS}  `
      + `${Math.round(ms / scores.length)} мс  $${(cost / scores.length).toFixed(5)}  `
      + `${Math.round(chars / scores.length)} зн.`,
    );
  }
}

async function main(): Promise<void> {
  const key = apiKey();
  await bench(key, "позитив (случай есть)", readFileSync("bench/agent-args.txt", "utf8"), true);
  await bench(key, "контроль (случая нет)", readFileSync("bench/agent-ctl.txt", "utf8"), false);
}

await main();
