/**
 * Сплошной отбор суммаризаторов по каталогу OpenRouter.
 *
 * Прошлый опыт взял шесть моделей из головы. Здесь берутся все модели каталога
 * с текстовым входом и выходом, контекстом ≥100k и ценой ниже Gemini 2.5 Flash,
 * и каждая проходит ту же пробу: сводка реального окна со случаем и окна без
 * случая, затем оценка классификатора.
 *
 * Метрика отбора — зазор: минимальная оценка на позитиве минус максимальная на
 * контроле. Он важнее абсолютной оценки: модель, дающая 0,9 и 0,8, отделяет
 * случай хуже, чем дающая 0,7 и 0,05.
 *
 * Запуск: node --experimental-strip-types scripts/screen.ts
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

/** Цена Gemini 2.5 Flash за миллион токенов — предел для отбора. */
const GEMINI_IN = 0.3;
const GEMINI_OUT = 2.5;
const RUNS = 2;
const MAX_TOKENS = 4000;

interface Model {
  id: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
}

function apiKey(): string {
  const match = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"));
  if (!match) throw new Error("ключ не найден");
  return match[0];
}

async function candidates(key: string): Promise<Model[]> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const payload = (await response.json()) as { data: Model[] };
  return payload.data
    .filter((model) => model.architecture?.output_modalities?.includes("text"))
    .filter((model) => model.architecture?.input_modalities?.includes("text"))
    .filter((model) => model.context_length >= 100_000)
    .map((model) => ({
      model,
      prompt: Number(model.pricing.prompt) * 1_000_000,
      completion: Number(model.pricing.completion) * 1_000_000,
    }))
    .filter((row) => Number.isFinite(row.prompt) && Number.isFinite(row.completion))
    .filter((row) => row.prompt > 0 && row.prompt < GEMINI_IN && row.completion < GEMINI_OUT)
    .sort((left, right) => left.prompt + left.completion / 8 - (right.prompt + right.completion / 8))
    .map((row) => row.model);
}

interface Result {
  model: string;
  positive: number[];
  control: number[];
  ms: number;
  cost: number;
  empty: number;
  note: string;
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
      max_tokens: MAX_TOKENS,
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

async function trial(key: string, model: string, positive: string, control: string): Promise<Result> {
  const result: Result = { model, positive: [], control: [], ms: 0, cost: 0, empty: 0, note: "" };
  for (const [input, into] of [[positive, result.positive], [control, result.control]] as [string, number[]][]) {
    for (let run = 0; run < RUNS; run += 1) {
      try {
        const row = await summarize(key, model, input);
        result.ms += row.ms;
        result.cost += row.cost;
        if (row.text.trim() === "") {
          result.empty += 1;
          continue;
        }
        const verdict = await classify(row.text, READY, { apiKey: key });
        into.push(verdict.score);
      } catch (error) {
        result.empty += 1;
        result.note = String(error).slice(0, 60);
      }
    }
  }
  return result;
}

async function main(): Promise<void> {
  const key = apiKey();
  const positive = readFileSync("bench/agent-args.txt", "utf8");
  const control = readFileSync("bench/agent-ctl.txt", "utf8");

  const all = await candidates(key);
  // Из каждой семьи берём не больше двух: иначе список заполнят пресеты одной.
  const perFamily = new Map<string, number>();
  const chosen: string[] = [];
  for (const model of all) {
    const family = model.id.split("/")[0] ?? model.id;
    const taken = perFamily.get(family) ?? 0;
    if (taken >= 2) continue;
    perFamily.set(family, taken + 1);
    chosen.push(model.id);
  }
  const shortlist = chosen.slice(0, Number(process.argv[2] ?? 16));
  console.log(`всего дешёвых и с большим контекстом: ${all.length}, в отбор: ${shortlist.length}`);
  console.log(`позитив ${positive.length} зн., контроль ${control.length} зн., прогонов на окно ${RUNS}\n`);

  const results: Result[] = [];
  for (const model of shortlist) {
    process.stdout.write(`${model.padEnd(38)} `);
    const result = await trial(key, model, positive, control);
    results.push(result);
    if (result.positive.length === 0 || result.control.length === 0) {
      console.log(`нет замера (пусто ${result.empty}, ${result.note})`);
      continue;
    }
    const margin = Math.min(...result.positive) - Math.max(...result.control);
    console.log(
      `позитив ${Math.min(...result.positive).toFixed(3)}–${Math.max(...result.positive).toFixed(3)}  `
      + `контроль ${Math.max(...result.control).toFixed(3)}  зазор ${margin.toFixed(3).padStart(6)}  `
      + `${Math.round(result.ms / 4)} мс  $${(result.cost / 4).toFixed(5)}`,
    );
  }

  const ranked = results
    .filter((result) => result.positive.length > 0 && result.control.length > 0)
    .sort((left, right) => {
      const leftMargin = Math.min(...left.positive) - Math.max(...left.control);
      const rightMargin = Math.min(...right.positive) - Math.max(...right.control);
      return rightMargin - leftMargin;
    });

  console.log("\nпо зазору:");
  for (const result of ranked) {
    const margin = Math.min(...result.positive) - Math.max(...result.control);
    const ok = margin >= 0.4 && Math.min(...result.positive) >= 0.6;
    console.log(
      `  ${ok ? "годна " : "нет   "} ${result.model.padEnd(38)} зазор ${margin.toFixed(3)}  `
      + `$${(result.cost / 4).toFixed(5)}/окно  ${Math.round(result.ms / 4)} мс`,
    );
  }
  writeFileSync("bench/screen.json", JSON.stringify(ranked, null, 2), "utf8");
  const total = results.reduce((sum, result) => sum + result.cost, 0);
  console.log(`\nвсего за опыт: $${total.toFixed(5)}`);
}

await main();
