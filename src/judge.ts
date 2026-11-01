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

  const names: string[] = [];
  const ready = new Set<string>();
  // Случай — это «<предложение> — вместо <готовое>». Разделитель случаев —
  // перевод строки или маркер списка. Точка с запятой им не служит: сводка
  // пишет ею продолжение той же фразы («…; задачей закрывает … вместо …»),
  // и разрезание по ней выдумывало второй случай из объяснения первого.
  for (const rawLine of section.split("\n")) {
    for (const piece of rawLine.split(/(?:^|\s)[-•]\s+/)) {
      let line = piece.replace(/^[\s*`«»"]+|[\s*`«»"]+$/g, "").trim();
      // Заголовок раздела часто стоит в одной строке с первым случаем:
      // «ВМЕСТО ГОТОВОГО — главное. <случай>». Без отреза берётся «главное».
      line = line.replace(/^ВМЕСТО ГОТОВОГО\s*(?:[—–-]\s*)?(?:главное\s*)?[.:*]*\s*/i, "").trim();
      if (line === "") continue;
      // `\w` в JS не матчит кириллицу: «вместо готового нет» через `готов\w*`
      // не срабатывало, и отрицание попадало в имена словом «предложений».
      if (/вместо\s+[а-яё]+\s+нет/i.test(line)) continue;
      const split = line.search(/вместо|замен|обход/i);
      if (split < 0) continue;
      for (const name of namesIn(line.slice(0, split))) names.push(name);
      for (const name of readyNames(line.slice(split))) ready.add(name);
    }
  }
  return [...new Set(names)].filter((name) => !ready.has(name));
}

/**
 * Что агент предлагал сделать. Может быть и именем, и описанием работы.
 *
 * Замер прогона: из 8 случаев «вместо готового» парсер доставал 2. Четыре
 * разных вида он терял, и все четыре — настоящая работа без имени:
 *   «RunContext — вместо …» (латиница одним словом);
 *   «собственный тест границы импортов — вместо …» (описание);
 *   «Проводка через замыкания — вместо …» (описание);
 *   «самописная отправка запросов — вместо …» (описание).
 * Поэтому берём всё, что стоит до тире, а не только один идентификатор.
 */
function namesIn(head: string): string[] {
  const cut = head
    .replace(/^[\s*`«»"'«]+|[\s*`«»"'«]+$/g, "")
    .replace(/\s+[—–]\s*$/, "")
    .trim()
    .replace(/[:;,\.]+\s*$/, "");
  if (cut === "") return [];
  // Обрывок перечисления или обрезанная по длине сводка: «предложений вместо
  // готов» — это начало фразы «предложений … нет», а не название работы.
  if (cut.split(/\s+/).length < 2 && !/^[A-Za-z_$]/.test(cut)) return [];
  // Имя — одно слово латиницей: его ищет проверка существования.
  if (/^[A-Za-z_$][\w$.:]*$/.test(cut)) return [cut];
  // Описание — тоже предложение своей вещи, но кодом его не проверить.
  return cut.length >= 4 && cut.length <= 120 ? [cut] : [];
}

/** Что из названного уже готово: механизмы библиотеки и файлы проекта. */
function readyNames(tail: string): string[] {
  const out: string[] = [];
  for (const token of tail.split(/[\s,()\[\]…:;«»"]+/)) {
    const clean = token.replace(/[.:;]+$/, "").trim();
    // Имя с точкой — механизм библиотеки; путь с косой чертой — файл проекта.
    if ((clean.includes(".") && clean.length > 3) || (clean.includes("/") && clean.length > 4)) out.push(clean);
  }
  return out;
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
