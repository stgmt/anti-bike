/**
 * Ступень 2: сжатие окна работы агента перед классификатором.
 *
 * Автор 2026-11-01: «чтоб передвалось самари транскриба а не траскриб, а потом
 * уже если чтото найдено то уже транскриб», уточнение: «сводка из ответов
 * агента … без рассуждений и промптов и выборов юзера … делать самари».
 *
 * Модель выбрана отбором по всему каталогу OpenRouter, решение автора:
 * qwen/qwen3.7-flash, $0,00075 за окно. Замеры — reports/analysis-20261101.md.
 *
 * Что важно и почему записано здесь:
 *   потолок 4000 токенов — при 1500 рассуждение съедает лимит и ответ пустой;
 *   пустой ответ — не «чисто», а «нет замера»: его повторяют, а не считают нулём.
 *
 * Вход — ответы агента и параметры его вызовов. Без вызовов случай теряется:
 * 0,214 против 0,753 на одном окне (§2.7 отчёта).
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export const DEFAULT_SUMMARIZER = "qwen/qwen3.7-flash";
/** Ниже этого рассуждение съедает лимит и content приходит пустым. */
export const MIN_MAX_TOKENS = 4000;

/**
 * Инструкция сводки.
 *
 * Задание, а не запрет: что сохранить, в каком виде. Запреты «не пересказывай»
 * здесь только уточняют, что считать работой агента, и обоснованы замером:
 * на входе без вызовов инструментов случай не находится.
 */
export const SUMMARY_INSTRUCTION = `Ты сжимаешь протокол работы агента-программиста.
Вход — только то, что агент сказал сам и чем он вызвал инструменты.

Пиши по-русски, списком. Сохрани:
- какие сущности, классы и слои агент предлагал СОЗДАТЬ, названия дословно;
- какие файлы он записал и что в них нового;
- что он предлагал владельцу и какими словами.

Не пересказывай прочитанные файлы и вывод команд. Не оценивай качество работы.
Если агент предлагал своё вместо готового механизма библиотеки или того, что в
проекте уже написано, назови это прямо: «предложил своё вместо <библиотека.механизм>».`;

export interface SummarizeOptions {
  /** Ключ шлюза. Не печатать и не логировать. */
  apiKey: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface Summary {
  text: string;
  /** Сколько знаков было на входе и стало на выходе. */
  inputChars: number;
  outputChars: number;
  ms: number;
  cost: number;
  /** Пустой ответ: это не «чисто». */
  empty: boolean;
  /** Чем кончилось, если пусто: длина, отказ, ошибка. */
  note: string;
}

/** Сжимает окно работы агента в сводку. Пустой ответ помечается как пустой. */
export async function summarize(
  window: string,
  options: SummarizeOptions,
): Promise<Summary> {
  const started = performance.now();
  const maxTokens = Math.max(options.maxTokens ?? MIN_MAX_TOKENS, MIN_MAX_TOKENS);
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model ?? DEFAULT_SUMMARIZER,
      messages: [
        { role: "system", content: SUMMARY_INSTRUCTION },
        { role: "user", content: window },
      ],
      max_tokens: maxTokens,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
  });
  const ms = Math.round(performance.now() - started);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`сводка ответила ${response.status}: ${detail}`);
  }
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { cost?: number };
  };
  const text = payload.choices?.[0]?.message?.content ?? "";
  const finish = payload.choices?.[0]?.finish_reason ?? "?";
  const empty = text.trim() === "";
  return {
    text,
    inputChars: window.length,
    outputChars: text.length,
    ms,
    cost: payload.usage?.cost ?? 0,
    empty,
    note: empty ? `пусто, finish=${finish}` : "",
  };
}
