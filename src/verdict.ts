/**
 * Арбитр пары: одно ли занятие у своего и готового кода.
 *
 * Зачем третий слой. Форма по токенам отвечает на вопрос «то же строение?»,
 * и на выборке из 40 окон она дала 39 совпадений, из которых настоящих
 * единицы: `isStateFile` проверяет ещё `nlink`, `awaitWithAbort` отменяет
 * чужую операцию, а не ждёт таймер — строение общее, занятие разное.
 *
 * Признак берётся не из слов агента (он о велосипеде молчит) и не из имён
 * (они разные). Модель получает ТОЛЬКО два тела и отвечает, одна ли работа
 * у них. Стоимость — одна короткая задача на пару, без эмбеддингов.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_ARBITER = "qwen/qwen3.7-flash";

const INSTRUCTION = `Сравни две функции. Ответь одной строкой JSON:
{"same": true|false, "why": "<до 12 слов>"}

same = true, если обе делают ОДНУ И ТУ ЖЕ работу: одинаковый вход по смыслу,
одинаковый результат, взаимозаменяемы в коде.

same = false, если:
- одна проверяет больше условий или делает больше шагов;
- у них разные входы или разные выходы;
- одна оборачивает чужую работу, другая сама её выполняет;
- общее у них только строение (try/catch, Promise, цикл повтора).

Не смотри на имена. Смотри на работу.`;

export interface PairVerdict {
  same: boolean;
  why: string;
}

/** Одна ли работа у двух тел. */
export async function judgePair(
  own: { name: string; body: string },
  ready: { name: string; body: string },
  options: { apiKey: string; model?: string },
): Promise<PairVerdict> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model ?? DEFAULT_ARBITER,
      messages: [
        { role: "system", content: INSTRUCTION },
        {
          role: "user",
          content: `ПЕРВАЯ:\n${own.body.slice(0, 2500)}\n\nВТОРАЯ:\n${ready.body.slice(0, 2500)}`,
        },
      ],
      max_tokens: 4000,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`арбитр ответил ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const text = (payload.choices?.[0]?.message?.content ?? "").trim();
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return { same: false, why: `не разобрал ответ: ${text.slice(0, 80)}` };
  try {
    const parsed = JSON.parse(match[0]) as { same?: unknown; why?: unknown };
    return { same: parsed.same === true, why: String(parsed.why ?? "").slice(0, 200) };
  } catch {
    return { same: false, why: `битый JSON: ${match[0].slice(0, 80)}` };
  }
}

/**
 * Повтор на 429 и кеш ответов.
 *
 * Замер 2026-11-02: `TeamOperationQueue → KeyedMutex` в первом прогоне получил
 * «да», во втором «нет» — та же пара, те же тела, temperature 0. Причина в
 * шлюзе: qwen3.7-flash бывает rate-limited, а прогон из 30 пар обрывается на
 * середине, и половина списка остаётся без вердикта.
 *
 * Кеш лежит в `.cache/arbiter.json` по хешу обоих тел: повторный прогон по тем
 * же парам бесплатен и даёт те же вердикты, а новый прогон платит только за
 * новые пары.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const CACHE = "C:/Users/stigm/AppData/Local/Temp/antibike-arbiter-cache.json";

function cacheKey(own: string, ready: string, model: string): string {
  return createHash("sha256").update(`${model}\u0000${own}\u0000${ready}`).digest("hex");
}

function loadCache(): Record<string, PairVerdict> {
  try {
    return JSON.parse(readFileSync(CACHE, "utf8")) as Record<string, PairVerdict>;
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, PairVerdict>): void {
  try {
    mkdirSync(CACHE.slice(0, CACHE.lastIndexOf("/")), { recursive: true });
    writeFileSync(CACHE, JSON.stringify(cache, null, 1), "utf8");
  } catch {
    // Кеш — ускорение, а не условие: не записался, прогон всё равно идёт.
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Одна ли работа, с кешем и повтором на 429.
 *
 * Пять попыток с нарастающей паузой: rate-limit шлюза проходит за секунды,
 * а ждать его дешевле, чем бросать прогон на середине списка.
 */
export async function judgePairCached(
  own: { name: string; body: string },
  ready: { name: string; body: string },
  options: { apiKey: string; model?: string },
): Promise<PairVerdict> {
  const model = options.model ?? DEFAULT_ARBITER;
  const key = cacheKey(own.body, ready.body, model);
  const cache = loadCache();
  const hit = cache[key];
  if (hit) return hit;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const verdict = await judgePair(own, ready, options);
      cache[key] = verdict;
      saveCache(cache);
      return verdict;
    } catch (error) {
      lastError = error;
      const message = String(error);
      if (!message.includes("429") && !message.includes("timeout")) throw error;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw lastError;
}
