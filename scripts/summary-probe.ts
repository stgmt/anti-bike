/**
 * Опыт: переживает ли случай RunContext сжатие транскрипта в сводку.
 *
 * Вопрос автора: отдавать классификатору сводку, а транскрипт — только когда
 * что-то нашлось. Тогда надо знать, не теряется ли решение в сводке.
 *
 * Опыт идёт на настоящем потоке решений одной сессии. Сводка делается
 * несколькими моделями, каждая сжимается до одного размера. Затем
 * классификатор отвечает по сводке и по сырому потоку — сравниваем.
 *
 * Запуск: node --experimental-strip-types scripts/summary-probe.ts
 */

import { readFileSync } from "node:fs";

const KEY_FILE =
  "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** Модели, которые стоит сравнить: дешёвые и заявленные как суммаризаторы. */
const CANDIDATES = [
  "scaledown/summarize",
  "openai/gpt-oss-120b",
  "qwen/qwen3.7-flash",
  "inclusionai/ling-3.0-flash",
  "anthropic/claude-haiku-5.5",
  "google/gemma-4-31b-it:free",
];

const INSTRUCTION = `Ты сжимаешь протокол работы агента-программиста.

Пиши по-русски, списком. Сохрани без потерь:
- что просил владелец проекта, его словами в кавычках;
- какие сущности, классы, слои и модули агент предлагал СОЗДАТЬ или ВВЕСТИ (названия дословно);
- что агент писал в файлы: путь и что нового;
- какие решения принял владелец в ответ.

Не пересказывай прочитанные файлы и вывод команд. Не оценивай качество работы.
Если агент предлагал сделать своими руками то, что уже умеет установленная
библиотека (langgraph, langchain, pydantic, deepagents, asyncio), назови это
прямо: «предложил своё вместо <библиотека.механизм>».

Вход размечен: [owner] — владелец, [agent] — агент, [agent-wrote] — что записал в файл,
[agent-proposed] — предложение владельцу.`;

function apiKey(): string {
  const match = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"));
  if (!match) throw new Error("ключ не найден");
  return match[0];
}

interface Call {
  model: string;
  ok: boolean;
  ms: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  chars: number;
  text: string;
  error?: string;
}

async function summarize(key: string, model: string, stream: string): Promise<Call> {
  const started = performance.now();
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: INSTRUCTION },
          { role: "user", content: stream },
        ],
        max_tokens: 1200,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const ms = Math.round(performance.now() - started);
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      return { model, ok: false, ms, cost: 0, inputTokens: 0, outputTokens: 0, chars: 0, text: "", error: `${response.status} ${detail}` };
    }
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };
    const message = payload.choices?.[0]?.message as
      | { content?: string; reasoning?: string; refusal?: string }
      | undefined;
    // Пустой content при непустом reasoning — ответ ушёл в рассуждение.
    const text = message?.content ?? "";
    const reason = message?.reasoning ?? "";
    const refusal = message?.refusal ?? "";
    const why = text.trim() === ""
      ? `пусто; рассуждение ${reason.length} зн., отказ «${refusal.slice(0, 120)}»`
      : undefined;
    return {
      model,
      ok: text.trim() !== "",
      error: why,
      ms,
      cost: payload.usage?.cost ?? 0,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
      chars: text.length,
      text,
    };
  } catch (error) {
    return { model, ok: false, ms: Math.round(performance.now() - started), cost: 0, inputTokens: 0, outputTokens: 0, chars: 0, text: "", error: String(error).slice(0, 160) };
  }
}

async function main(): Promise<void> {
  const source = process.argv[2] ?? "bench/stream-carousel.txt";
  const key = apiKey();
  const stream = readFileSync(source, "utf8");
  console.log(`поток решений: ${(stream.length / 1024).toFixed(0)} КБ, ${stream.length.toLocaleString("ru")} знаков`);
  console.log(`моделей в опыте: ${CANDIDATES.length}\n`);

  const results: Call[] = [];
  for (const model of CANDIDATES) {
    process.stdout.write(`${model.padEnd(32)} `);
    const call = await summarize(key, model, stream);
    results.push(call);
    if (call.ok) {
      console.log(
        `ok ${String(call.ms).padStart(6)} мс  ${String(call.chars).padStart(5)} знаков  `
        + `${(call.chars / stream.length * 100).toFixed(2)}% входа  $${call.cost.toFixed(5)}`,
      );
    } else {
      console.log(`ОШИБКА ${call.ms} мс ${call.error}`);
    }
  }

  const ok = results.filter((call) => call.ok);
  if (ok.length === 0) {
    console.log("\nни одна модель не ответила");
    return;
  }

  // Главный вопрос: пережил ли сводку случай RunContext.
  console.log("\nсохранила ли сводка случай RunContext:");
  for (const call of ok) {
    const mentions = (call.text.match(/RunContext/g) ?? []).length;
    const proposes = call.text.toLowerCase().includes("предлож") || call.text.includes("ввести");
    console.log(`  ${call.model.padEnd(32)} упоминаний ${mentions}, говорит о предложении: ${proposes ? "да" : "нет"}`);
  }

  const best = [...ok].sort((a, b) => a.cost - b.cost)[0];
  console.log(`\nдешевле всех: ${best.model} — $${best.cost.toFixed(5)} за сводку`);
  console.log(`\n--- сводка ${best.model} (первые 1500 знаков) ---\n${best.text.slice(0, 1500)}`);
}

await main();
