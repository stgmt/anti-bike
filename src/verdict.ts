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
