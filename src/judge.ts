/**
 * Решение гейта по окну: сводка → существование → классификация.
 *
 * Порядок и причина каждого шага:
 *
 *   сводка называет только то, что предложено вместо готового (§ правка 2);
 *   проверка существования отсекает названное, что уже объявлено в пакете
 *   проекта: это работа, а не дубль (правка 1);
 *   классификатор выносит суждение по тому, что осталось.
 *
 * Правило: сомнение не блокирует. Пустая сводка — не «чисто», а «нет замера».
 */

import { type Verdict, classify } from "./classify.ts";
import { type Found, findDeclarations, splitByExistence } from "./exists.ts";
import { retryTransient } from "./retry.ts";
import { type Summary, summarize } from "./summarize.ts";

export type WindowKind = "bike" | "clean" | "no-signal" | "error";

export interface WindowResult {
  kind: WindowKind;
  /** Почему так: идёт в замеры и в причину блокировки. */
  reason: string;
  /** Названо в сводке как «вместо готового». */
  proposed: string[];
  /** Из названного уже объявлено в пакете проекта. */
  exists: Found[];
  /** Из названного в пакете нет. */
  absent: string[];
  /** Корни, которых нет на диске: проверка не состоялась. */
  missingRoots: string[];
  summary: Summary | null;
  verdict: Verdict | null;
  cost: number;
  ms: number;
  error: string | null;
}

export interface WindowDeps {
  apiKey: string;
  /** Каталоги пакета проекта для проверки существования. */
  roots: string[];
  /** Готовое из библиотек: список механизмов для классификатора. */
  ready: string;
  model?: string;
  threshold?: number;
}

/**
 * Достаёт из сводки названия сущностей.
 *
 * Сводка пишет их в обратных кавычках — это её формат, а не догадка. Берём
 * только первый раздел «ВМЕСТО ГОТОВОГО», потому что остальные разделы
 * описывают работу, а не предложение.
 */
export function proposedNames(summary: string): string[] {
  const head = summary.indexOf("ВМЕСТО ГОТОВОГО");
  if (head < 0) return [];
  const tail = summary.indexOf("СОЗДАЛ НОВОЕ", head);
  const section = summary.slice(head, tail > 0 ? tail : undefined);

  // Сводка пишет имена по-разному: в обратных кавычках и без них. Разметка —
  // не контракт, поэтому имена берём по структуре строки, а не по бэктикам.
  const names: string[] = [];
  const isReady = new Set<string>();
  for (const rawLine of section.split("\n")) {
    const line = rawLine
      .replace(/^[\s*`-]+/, "")
      .replace(/[*`«»"]/g, "")
      .trim();
    if (line === "" || line.startsWith("ВМЕСТО ГОТОВОГО")) continue;
    if (line.includes("вместо готового") && /нет\b/i.test(line)) continue;

    const split = line.search(/вместо|замен|обход/i);
    const head2 = split >= 0 ? line.slice(0, split) : line;
    const tail2 = split >= 0 ? line.slice(split) : "";

    // «RunContext — вместо …»: имя стоит до тире. Без тире — первое слово строки.
    const dash = head2.search(/\s+[—–-]\s+/);
    const lead = (dash >= 0 ? head2.slice(0, dash) : head2).trim().replace(/[:;,]+\s*$/, "");
    if (lead !== "" && lead.length <= 80 && lead.split(/\s+/).length === 1 && /[A-Za-z_]/.test(lead)) {
      names.push(lead);
    }

    // Готовое — всё, что стоит после слова «вместо»: имя с точкой — механизм.
    for (const token of tail2.split(/[\s,()\[\]…:;]+/)) {
      const clean = token.replace(/[.:;]+$/, "").trim();
      if (clean.includes(".") && clean.length > 3) isReady.add(clean);
    }
  }
  return [...new Set(names)].filter((name) => !isReady.has(name));
}

/** Полный проход по окну. */
export async function judgeWindow(
  windowText: string,
  deps: WindowDeps,
): Promise<WindowResult> {
  const started = performance.now();
  const base: WindowResult = {
    kind: "error",
    reason: "",
    proposed: [],
    exists: [],
    absent: [],
    missingRoots: [],
    summary: null,
    verdict: null,
    cost: 0,
    ms: 0,
    error: null,
  };

  let summary: Summary;
  try {
    summary = await summarize(windowText, { apiKey: deps.apiKey, model: deps.model });
  } catch (error) {
    return { ...base, reason: "сводка не отработала", error: String(error).slice(0, 200), ms: Math.round(performance.now() - started) };
  }
  base.summary = summary;
  base.cost += summary.cost;
  if (summary.empty) {
    return {
      ...base,
      kind: "no-signal",
      reason: "сводка пуста: это не «чисто», замера нет",
      ms: Math.round(performance.now() - started),
    };
  }

  const proposed = proposedNames(summary.text);
  base.proposed = proposed;

  // Названо что-то, что уже объявлено в пакете — это работа, а не дубль.
  let found: Found[];
  let missingRoots: string[];
  try {
    ({ found, missingRoots } = await findDeclarations(proposed, { roots: deps.roots }));
  } catch (error) {
    return {
      ...base,
      kind: "no-signal",
      reason: "проверка существования не отработала: это не «чисто»",
      error: String(error).slice(0, 200),
      ms: Math.round(performance.now() - started),
    };
  }
  const { exists, absent } = splitByExistence(proposed, found);
  base.exists = exists;
  base.absent = absent;
  base.missingRoots = missingRoots;

  // Проверки не было — судить не по чему: говорим прямо, а не «нет».
  if (missingRoots.length > 0 && found.length === 0) {
    return {
      ...base,
      kind: "no-signal",
      reason: `проверка существования не состоялась: нет каталога ${missingRoots.join(", ")}`,
      ms: Math.round(performance.now() - started),
    };
  }

  if (proposed.length > 0 && absent.length === 0) {
    return {
      ...base,
      kind: "clean",
      reason: `всё названное уже есть в пакете: ${exists.map((item) => `${item.name} (${item.where})`).join(", ")}`,
      ms: Math.round(performance.now() - started),
    };
  }

  let verdict: Verdict;
  try {
    // Временная занятость модели — не повод терять окно.
    verdict = await retryTransient(() => classify(summary.text, deps.ready, {
      apiKey: deps.apiKey,
      threshold: deps.threshold,
    }));
  } catch (error) {
    return { ...base, reason: "классификатор не отработал", error: String(error).slice(0, 200), ms: Math.round(performance.now() - started) };
  }
  base.verdict = verdict;
  base.cost += verdict.cost;

  if (!verdict.bike) {
    return {
      ...base,
      kind: "clean",
      reason: `оценка ${verdict.score.toFixed(3)} ниже порога`,
      ms: Math.round(performance.now() - started),
    };
  }

  return {
    ...base,
    kind: "bike",
    reason: `оценка ${verdict.score.toFixed(3)}; названо и нет в пакете: ${absent.join(", ") || "имена не названы"}`,
    ms: Math.round(performance.now() - started),
  };
}
