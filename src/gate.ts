/**
 * Решение гейта: пропустить, блокировать или промолчать при сбое.
 *
 * Правило одно: **сомнение не блокирует**. Ложная блокировка учит агента
 * игнорировать гейт, а пропуск стоит одного лишнего хода.
 */

import { classify, DEFAULT_THRESHOLD, type Verdict } from "./classify.ts";
import { detectIntent, type Intent } from "./intent.ts";
import type { Duplication } from "./mcp.ts";

export type VerdictKind = "skip" | "block" | "error";

export interface GateResult {
  kind: VerdictKind;
  /** Почему так решили: идёт в замеры и в причину блокировки. */
  reason: string;
  /** Что видит агент при блокировке. Пусто, когда пропускаем. */
  message: string;
  intent: Intent;
  score: number | null;
  duplications: Duplication[];
  ms: { parse: number; mcp: number; context: number; model: number };
  cost: number;
  /** Ошибка, если была: гейт не должен падать молча. */
  error: string | null;
}

export interface GateDeps {
  /** Проверка фрагмента через jscpd MCP. */
  checkClones: (code: string) => Promise<Duplication[]>;
  /** Список готового из проекта. */
  readyContext: () => Promise<string>;
  /** Суждение модели. */
  judge: (text: string, ready: string) => Promise<Verdict>;
  /** Язык фрагмента для jscpd. */
  format: string;
}

export interface GateInput {
  /** Текст последнего ответа агента. */
  message: string;
  /** Код, который агент написал или собирается написать. Может быть пустым. */
  code: string;
  /** Был ли уже блок в этом ходе: тогда не гоняем второй раз. */
  stopHookActive: boolean;
  threshold?: number;
}

/** Одна строка причины для блокировки: адрес кода или механизм. */
function buildMessage(duplications: Duplication[], score: number): string {
  const lines = ["anti-bike: в ходе обещан новый код, который уже есть.", ""];
  if (duplications.length > 0) {
    lines.push("Уже есть:");
    for (const row of duplications.slice(0, 3)) {
      lines.push(`  ${row.file}:${row.fileStartLine} (${row.kind}, ${row.lines} строк)`);
    }
  }
  lines.push("");
  lines.push(
    duplications.length > 0
      ? "Возьми готовое или назови, чем твоё отличается."
      : "Сверься со списком готового и назови, чем твоё отличается.",
  );
  lines.push(`(уверенность ${score.toFixed(2)})`);
  return lines.join("\n");
}

/**
 * Главная функция. Порядок ступеней важен: каждая следующая дороже предыдущей,
 * поэтому при отказе на дешёвой дорогая не зовётся.
 */
export async function runGate(
  input: GateInput,
  deps: GateDeps,
): Promise<GateResult> {
  const empty = { parse: 0, mcp: 0, context: 0, model: 0 };
  const skip = (reason: string): GateResult => ({
    kind: "skip",
    reason,
    message: "",
    intent: { promise: false, matches: [] },
    score: null,
    duplications: [],
    ms: empty,
    cost: 0,
    error: null,
  });

  // AB-07: повторный Stop не гоняем — иначе блокировка зацикливается.
  if (input.stopHookActive) return skip("повторный Stop");

  // AB-01: дешёвый отсев до всякой сети.
  const parseStart = performance.now();
  const intent = detectIntent(input.message);
  const parseMs = Math.round(performance.now() - parseStart);
  if (!intent.promise) return { ...skip("нет обещания новой сущности"), intent, ms: { ...empty, parse: parseMs } };

  try {
    // Ступень 2: факт о коде. Пустой код — тоже ответ, а не ошибка.
    const mcpStart = performance.now();
    const duplications = input.code.trim() === "" ? [] : await deps.checkClones(input.code);
    const mcpMs = Math.round(performance.now() - mcpStart);

    // Список готового нужен модели, без него вопрос бессмыслен.
    const contextStart = performance.now();
    const ready = await deps.readyContext();
    const contextMs = Math.round(performance.now() - contextStart);

    // Ступень 3: суждение.
    const verdict = await deps.judge(input.message, ready);

    // AB-06: порог. Ниже — пропуск, даже если клон нашёлся.
    if (!verdict.bike) {
      return {
        kind: "skip",
        reason: `ниже порога ${input.threshold ?? DEFAULT_THRESHOLD}`,
        message: "",
        intent,
        score: verdict.score,
        duplications,
        ms: { parse: parseMs, mcp: mcpMs, context: contextMs, model: verdict.ms },
        cost: verdict.cost,
        error: null,
      };
    }

    return {
      kind: "block",
      reason: duplications.length > 0 ? `клон ${duplications[0].file}:${duplications[0].fileStartLine}` : "механизм из списка готового",
      message: buildMessage(duplications, verdict.score),
      intent,
      score: verdict.score,
      duplications,
      ms: { parse: parseMs, mcp: mcpMs, context: contextMs, model: verdict.ms },
      cost: verdict.cost,
      error: null,
    };
  } catch (error) {
    // AB-10: сбой jscpd или модели не блокирует ход и не прячется.
    return {
      ...skip("сбой ступени"),
      intent,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
