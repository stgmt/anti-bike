/**
 * Повтор временных отказов шлюза.
 *
 * Замер прогона: 2 окна из 150 потеряны на HTTP 429 «Model busy» от
 * классификатора, 9 — на пустой сводке при низком потолке. Оба случая
 * временные, и терять окно из-за них нельзя: окно — это час работы агента.
 *
 * Правило: повторяем только то, что пройдёт само. Отказ по схеме, по ключу и
 * по неверному запросу повторять бессмысленно, он остаётся ошибкой.
 */

const TRANSIENT = ["429", "busy", "overloaded", "timeout", "ETIMEDOUT", "ECONNRESET", "502", "503", "504"];

/** Временный ли отказ: такой повторяют, остальные — нет. */
export function isTransient(error: unknown): boolean {
  const text = String(error).toLowerCase();
  return TRANSIENT.some((marker) => text.includes(marker.toLowerCase()));
}

export interface RetryOptions {
  /** Сколько всего попыток, включая первую. */
  attempts?: number;
  /** Базовая пауза: растёт линейно с номером попытки. */
  delayMs?: number;
  onRetry?: (attempt: number, error: unknown) => void;
}

/** Выполняет вызов, повторяя только временные отказы. */
export async function retryTransient<T>(
  call: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 4;
  const delayMs = options.delayMs ?? 3_000;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      last = error;
      if (!isTransient(error) || attempt === attempts) throw error;
      options.onRetry?.(attempt, error);
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw last;
}
