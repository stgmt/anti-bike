/**
 * Ступень 3: суждение модели «повторяет ли текст готовое».
 *
 * Модель nace-ai/drex-max — family decision на OpenRouter, эндпоинт
 * POST /api/alpha/decisions, вопрос типа `noul` отдаёт вероятность 0..1.
 *
 * Замеры 2026-11-01, семь ходов настоящей сессии:
 *   позитив 0,974–0,992, трудный негатив 0,002–0,020, обычные негативы 0,001–0,019
 *   разброс между тремя прогонами ≤ 0,006, задержка 873–1300 мс
 *
 * Через chat/completions эта модель не работает: сервер отвечает 400
 * "is a decisions model and cannot be used with the chat/completions endpoint".
 */

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";

/**
 * Вопрос формулируется как задание, а не как ярлык.
 *
 * Проверено: «есть ли здесь предложение написать велосипед?» дало обратный ответ
 * (позитив 0,43, трудный негатив 0,77 у Jev). Работает задание найти в тексте
 * конкретное обещание новой сущности.
 */
const QUESTION = {
  type: "noul",
  instructions:
    "Дан текст агента и список того, что в проекте уже есть. Повторяет ли текст готовое — "
    + "предлагает ли он сделать то, что уже делает установленная библиотека или уже написано "
    + "в проекте?",
  criteria: {
    true: "текст предлагает свою сущность или слой для задачи, которую уже закрывает "
      + "названный механизм библиотеки или готовый код проекта",
    false: "текст не заводит ничего своего; либо заводит то, чего в списке готового нет "
      + "и что библиотека делать не умеет",
  },
} as const;

export interface Verdict {
  /** Вероятность «велосипед», 0..1. */
  score: number;
  /** Прошёл ли порог. */
  bike: boolean;
  /** Сколько занял вызов и сколько стоило. */
  ms: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  /** Какое имя модели ответило: шлюз может подставить версию. */
  served: string;
}

export interface ClassifyOptions {
  /** Ключ OpenRouter. Не печатать и не логировать. */
  apiKey: string;
  /** Порог, выше которого считаем велосипедом. */
  threshold?: number;
  model?: string;
  timeoutMs?: number;
}

export const DEFAULT_THRESHOLD = 0.5;
export const DEFAULT_MODEL = "nace-ai/drex-max";

/** Проверяет, повторяет ли текст готовое. Список готового обязателен. */
export async function classify(
  text: string,
  ready: string,
  options: ClassifyOptions,
): Promise<Verdict> {
  const body = {
    model: options.model ?? DEFAULT_MODEL,
    state: `${ready}\n\nТекст агента:\n${text}`,
    questions: { bike: QUESTION },
  };
  const started = performance.now();
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
  });
  const ms = Math.round(performance.now() - started);

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`decisions ответил ${response.status}: ${detail}`);
  }
  const payload = (await response.json()) as {
    model?: string;
    answers?: { bike?: { noul?: number } };
    usage?: { cost?: number; input_tokens?: number; output_tokens?: number };
  };
  const score = payload.answers?.bike?.noul;
  if (typeof score !== "number") {
    throw new Error(`в ответе нет answers.bike.noul: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return {
    score,
    bike: score >= (options.threshold ?? DEFAULT_THRESHOLD),
    ms,
    cost: payload.usage?.cost ?? 0,
    inputTokens: payload.usage?.input_tokens ?? 0,
    outputTokens: payload.usage?.output_tokens ?? 0,
    served: payload.model ?? "",
  };
}
