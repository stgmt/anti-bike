/**
 * Детектор велосипедов: окно транскрипта против готового кода репозитория.
 *
 * Признак — структурный клон, взвешенный по редкости токена. Замер 2026-11-02
 * на подтверждённом велосипеде `atomicFile.js` (свой повтор `rename` с
 * ожиданием через `Atomics.wait`) против `agent-teams-ai` в 14 244 функции:
 *
 *   вес по кратности         цель 0,645; находок ≥0,5 — 779
 *   вес по редкости токена   цель 0,512; находок ≥0,5 — 2
 *
 * Разница в причине: `if`, `return`, `(`, `)`, `{`, `}` есть в каждом теле,
 * и по ним совпадает что угодно. Редкий токен (`Atomics.wait` рядом с
 * `.rename`) почти не встречается в корпусе и потому и решает.
 *
 * jscpd (`clones.ts`) цель не видит: имена разные, последовательность токенов
 * расходится. Нормализация имён в классы — приём SourcererCC (arXiv 1512.06448),
 * оттуда же вес по частоте документа (IDF).
 *
 * Что НЕ велосипед и отсекается:
 *   - функция импортирует готовое: это и есть правильный путь;
 *   - функция объявлена до окна.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { functionsIn, type FnBody } from "./bodies.ts";
import { normalize, rareJaccard, identifiers, lexicalOverlap, type Tokens } from "./tokens.ts";

export interface WindowFunction {
  fn: FnBody;
  via: "Write" | "Edit";
}

const NOT_SOURCE = /\.(test|spec|d)\.|\.d\.ts$|\.testCases\.|(^|\/)tests?\/|(^|\/)test_[^/]*\.py$|_test\.go$/;
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", ".git", "coverage", "landing", ".venv", "vendor", ".next", "release",
]);

/** Своё: функции, объявленные в Write и Edit окна, из исходников. */
export async function ownFunctions(transcript: string, sourceFilter: RegExp): Promise<WindowFunction[]> {
  const lines = createInterface({ input: createReadStream(transcript, { encoding: "utf8" }), crlfDelay: Infinity });
  const out: WindowFunction[] = [];
  for await (const line of lines) {
    if (!line.includes("tool_use")) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const content = rec.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type !== "tool_use") continue;
      const input = b.input ?? {};
      const path = String(input.file_path ?? "").split("\\").join("/");
      if (!path || !sourceFilter.test(path)) continue;
      if (typeof input.content === "string") {
        for (const fn of functionsIn(input.content, path)) out.push({ fn, via: "Write" });
      }
      if (typeof input.new_string === "string") {
        for (const fn of functionsIn(input.new_string, path)) out.push({ fn, via: "Edit" });
      }
    }
  }
  const best = new Map<string, WindowFunction>();
  for (const w of out) {
    const prev = best.get(w.fn.name);
    if (!prev || w.fn.body.length > prev.fn.body.length) best.set(w.fn.name, w);
  }
  return [...best.values()];
}

/**
 * Путь относительно корня репозитория: окно пишет абсолютный, и часть файлов
 * лежит в другом чекауте того же репозитория (`E:/tmp/pub/merge/...`).
 */
export function relativeTo(file: string, repo: string): string {
  const norm = file.split("\\").join("/");
  const root = repo.split("\\").join("/").replace(/\/+$/, "");
  if (norm.startsWith(`${root}/`)) return norm.slice(root.length + 1);
  // Чужой чекаут того же репозитория: режем по первому каталогу исходников.
  const at = norm.search(/\/(?:agent-teams-controller\/)?src\//);
  if (at >= 0) return norm.slice(at + 1);
  return norm;
}

/**
 * Каталоги, где вообще есть исходники: `src`, `python`, пакет по имени
 * репозитория, `gateway`, `app` и подобное.
 *
 * Жёсткий список корней уже терял репозитории: у `carousel-demo` код в
 * `carousel/`, у `ai_halava` в `data/`, и там выходило 0 готовых при живом
 * коде. Корни ищем по факту, а не по памяти о раскладке.
 */
export function sourceRoots(repo: string, extensions: string[], depth = 2): string[] {
  const exts = extensions.length > 0 ? extensions : ["ts", "tsx", "js", "mjs", "cjs", "py", "go"];
  const out: string[] = [];
  const hasSource = (dir: string): boolean => {
    let entries;
    try {
      entries = readdirSync(`${repo}/${dir}`, { withFileTypes: true });
    } catch {
      return false;
    }
    return entries.some((e) => e.isFile() && exts.some((x) => e.name.endsWith(`.${x}`)));
  };
  const walk = (dir: string, d: number): void => {
    if (d > depth) return;
    let entries;
    try {
      entries = readdirSync(`${repo}/${dir}`, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      const rel = `${dir}/${e.name}`;
      if (hasSource(rel)) out.push(rel);
      walk(rel, d + 1);
    }
  };
  walk(".", 0);
  return out;
}

/** Готовое: все функции репозитория, кроме файлов, которые окно писало. */
export function readyFunctions(repo: string, exclude: Set<string>, roots?: string[], extensions?: string[]): FnBody[] {
  const found: FnBody[] = [];
  const exts = extensions ?? ["ts", "tsx", "js", "mjs", "cjs"];
  const walk = (dir: string, depth: number): void => {
    if (depth > 12) return;
    let entries;
    try {
      entries = readdirSync(`${repo}/${dir}`, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(rel, depth + 1);
        continue;
      }
      if (!exts.some((x) => e.name.endsWith(`.${x}`))) continue;
      // Тест не бывает готовым кодом: `tests/`, `test_*.py`, `*.test.ts`,
      // `*_test.go`. Замер: без этого 22 находки из 114 указывали в тест.
      if (NOT_SOURCE.test(e.name) || NOT_SOURCE.test(rel)) continue;
      if (exclude.has(rel)) continue;
      let text = "";
      try {
        text = readFileSync(`${repo}/${rel}`, "utf8");
      } catch {
        continue;
      }
      if (text.length > 400_000) continue;
      found.push(...functionsIn(text, rel));
    }
  };
  // Обходим репозиторий целиком: корни, найденные по наличию файлов
  // напрямую, пропускали `./src`, где исходники лежат только в подкаталогах.
  // Так из 12 541 готовой функции выпадал `KeyedMutex`.
  const use = roots ?? ["."];
  for (const root of use) walk(root.split("\\").join("/").replace(/^\.\//, ""), 0);
  const byName = new Map<string, FnBody>();
  for (const f of found) {
    const prev = byName.get(f.name);
    if (!prev || f.body.length > prev.body.length) byName.set(f.name, f);
  }
  return [...byName.values()];
}

export interface Verdict {
  own: string;
  ownFile: string;
  ready: string;
  readyFile: string;
  /** Сходство формы с весом по редкости токена. */
  shape: number;
  /** Доля общих слов: тот же предмет, а не только форма. */
  topic: number;
  /** Сколько токенов в своём теле: короткое не доказывает ничего. */
  tokens: number;
  /** Сколько раз готовое зовётся по репозиторию. */
  readyUses: number;
  /** Сколько раз своё зовётся по репозиторию. Ноль — написано и брошено. */
  ownUses: number;
}

export interface Corpus {
  functions: FnBody[];
  tokens: Tokens[];
  words: Set<string>[];
  /** Частота токена: сколько функций корпуса его содержат. */
  df: Map<string, number>;
}

/** Корпус готового: токены, слова и частоты считаются один раз на репозиторий. */
export function corpus(ready: FnBody[]): Corpus {
  const tokens = ready.map((f) => normalize(f.body));
  const df = new Map<string, number>();
  for (const t of tokens) for (const token of t.set) df.set(token, (df.get(token) ?? 0) + 1);
  return { functions: ready, tokens, words: ready.map((f) => identifiers(f.body)), df };
}

export interface DetectResult {
  verdicts: Verdict[];
  counts: { own: number; ready: number };
  threshold: number;
}

/**
 * Сколько раз имя встречается в текстах репозитория.
 *
 * Этим закрывается главный дефект формы: она не отличает велосипед от
 * совпадения по строению. Замер 2026-11-02 на окне tokenplan: у настоящей
 * пары готовое `KeyedMutex` зовётся 25 раз, своё `TeamOperationQueue` — 0.
 * У шумовых пар (`formatAge`→`formatBytes`, `show`→`CommentAttachments`)
 * обе стороны живые, и это видно сразу.
 *
 * Смысл тот же, что в метрике RepoReuse: reuse — доля готовых целей, которые
 * агент ВЫЗВАЛ. Написал своё, а готовое не позвал, хотя репозиторий его
 * зовёт — переписал.
 */
/**
 * Сколько раз имя встречается в исходниках репозитория.
 *
 * Отдельно — сколько из них НЕ в файле своего же объявления. Второе число и
 * решает: имя, которое встречается только там, где объявлено, никуда не
 * подключено.
 */
export function countUses(texts: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const text of texts) {
    for (const m of text.matchAll(/\b([A-Za-z_$][\w$]{2,})\b/g)) {
      const name = m[1]!;
      out.set(name, (out.get(name) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * Считает клоны своего кода против готового.
 *
 * Порог 0,5 — не из головы: на подтверждённом случае находок ≥0,5 ровно две
 * (сама пара и её сосед), при 0,6 — одна. Ниже 0,5 начинается шум: 0,44 у
 * посторонней функции.
 *
 * `minTokens` отсекает тела, у которых нет структуры для сравнения: 40
 * токенов — это примерно три оператора с вызовом.
 */
export function detectBikes(
  window: WindowFunction[],
  c: Corpus,
  options: { minTokens?: number; minShape?: number; minTopic?: number; uses?: Map<string, number> } = {},
): DetectResult {
  const minTokens = options.minTokens ?? 40;
  const minShape = options.minShape ?? 0.5;
  const minTopic = options.minTopic ?? 0.15;
  const total = c.functions.length;
  const verdicts: Verdict[] = [];
  // Имя, которое в репозитории уже есть, — не велосипед: это работа с
  // существующей сущностью (слово автора 2026-11-01, «Существование
  // проверять кодом»). Иначе правка готовой функции засчитывается как своя.
  const present = new Set(c.functions.map((f) => f.name));

  for (const w of window) {
    if (present.has(w.fn.name)) continue;
    const own = normalize(w.fn.body);
    if (own.seq.length < minTokens) continue;
    const words = identifiers(w.fn.body);
    let best = -1;
    let bestScore = 0;
    let bestTopic = 0;
    for (let i = 0; i < c.functions.length; i += 1) {
      const score = rareJaccard(own, c.tokens[i]!, c.df, total);
      if (score <= bestScore) continue;
      const topic = lexicalOverlap(words, c.words[i]!);
      if (topic < minTopic) continue;
      best = i;
      bestScore = score;
      bestTopic = topic;
    }
    if (best < 0 || bestScore < minShape) continue;
    const readyName = c.functions[best]!.name;
    verdicts.push({
      own: w.fn.name,
      ownFile: w.fn.source,
      ready: readyName,
      readyFile: c.functions[best]!.source,
      shape: bestScore,
      topic: bestTopic,
      tokens: own.seq.length,
      readyUses: options.uses?.get(readyName) ?? 0,
      ownUses: options.uses?.get(w.fn.name) ?? 0,
    });
  }
  verdicts.sort((a, b) => b.shape - a.shape);
  return { verdicts, counts: { own: window.length, ready: c.functions.length }, threshold: minShape };
}
