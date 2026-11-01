/**
 * Проверка повторного изобретения по образцу RepoReuse.
 *
 * Источник: «Do Coding Agents Reuse Existing Code or Reinvent the Wheel?»
 * (arXiv 2609.35357). Метрика статьи — reuse: доля готовых целей, которые
 * агент ВЫЗВАЛ. Написал своё, готовое не позвал — переписал.
 *
 * Замер 2026-11-02 на подтверждённом случае (tokenplan, effort):
 *   готовое `resolveAnthropicEffortSupport` отвечает ровно на вопрос
 *   «поддерживает ли модель effort» — и в коде есть, и вызывается в проекте;
 *   агент написал свой `createAnthropicEffortProbe`, который зовёт CLI;
 *   вызовов нового имени вне его объявления — 0.
 *
 * Почему без модели: в статье показано, что показ готового кода агенту почти
 * не помогает, а замер по этому окну — велосипед построен с нулём текста.
 * Спрашивать модель «похоже ли» значит опираться на то же, что и раньше.
 *
 * Что здесь считается:
 *   1. Объявлено в окне и нет до окна.
 *   2. Ни разу не вызвано вне своего объявления.
 *   3. Готовое с beckground: функция, которая уже отвечала на тот же вопрос.
 */

import type { Decl } from "./astgraph.ts";

export interface ReuseInput {
  declared: Decl[];
  /** Вызовы вне своего объявления: имя → сколько. */
  outside: Map<string, number>;
  /** Имена, объявленные в проекте до окна. */
  before: Set<string>;
}

export interface Candidate {
  decl: Decl;
  /** Почему считается кандидатом: одной строкой для отчёта. */
  why: string;
}

/**
 * Кандидаты в велосипеды: написано своё, не вызвано, до окна не было.
 *
 * Это отбор, а не приговор: совпадение имени с готовым — доказательство, а
 * одна новизна — только повод посмотреть.
 */
export function candidates(input: ReuseInput): Candidate[] {
  const out: Candidate[] = [];
  for (const decl of input.declared) {
    if (input.before.has(decl.name)) continue;
    const used = input.outside.get(decl.name) ?? 0;
    if (used > 0) continue;
    out.push({ decl, why: "объявлено в окне, вне своего объявления не вызывается" });
  }
  return out;
}

/**
 * Совпадает ли новое с готовым по задаче.
 *
 * Сравниваем не имена, а то, на какой вопрос отвечает код: слова из тела
 * нового объявления против слов из тела готового. Совпадение по редкому
 * слову весит больше, чем по частому: «effort» в этом проекте редкое,
 * «function» — нет.
 */
export function similarity(a: string, b: string): number {
  const words = (text: string): string[] =>
    text.toLowerCase().match(/[a-zа-яё]{4,}/g) ?? [];
  const left = new Set(words(a));
  const right = new Set(words(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/** Ищет готовое, на которое похоже новое объявление. */
export function nearest(
  decl: Decl,
  ready: { name: string; body: string }[],
): { name: string; score: number } | null {
  let best: { name: string; score: number } | null = null;
  for (const item of ready) {
    const score = similarity(decl.body, item.body);
    if (best === null || score > best.score) best = { name: item.name, score };
  }
  return best;
}
