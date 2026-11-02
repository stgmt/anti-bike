/**
 * Велосипеды внутри самого репозитория, без транскриптов.
 *
 * Зачем. Прогон по истории сессий видит только код, написанный после начала
 * записи. Велосипед, написанный раньше, ему не виден вовсе: в agent-teams-ai
 * такой один — `renameWithRetrySync` в `agent-teams-controller/src/internal/atomicFile.js`,
 * повтор готового `renameWithRetrySync` из `src/main/utils/atomicWrite.ts`.
 *
 * Признак отличается от прогона по транскриптам, и замер это показал.
 * Подключённость здесь не работает: в подтверждённом велосипеде готовая
 * `renameWithRetrySync` зовётся только из своего же файла, и своя копия — тоже
 * (функция `atomicWriteFileSync`). По вызовам обе выглядят живыми, а признак
 * «своё не зовут» даёт 4 086 «мёртвых» из 14 060 — это невидимый снаружи
 * служебный код, который в бандл попадает через вызовы внутри файла.
 *
 * Работает здесь ось времени: своя функция появилась ПОЗЖЕ готовой и повторяет
 * её форму. В подтверждённом велосипеде: `atomicWrite.ts` добавлен 2026-03-01,
 * `atomicFile.js` — 2026-05-15, тела совпадают по `renameSync`, коду ошибки и
 * `sleepSync` (сходство 0,542 из-за добавленной ветки `EXDEV`).
 *
 * Поэтому:
 *   - пара — две функции с похожей формой и общим предметом;
 *   - направление — по дате добавления файла в git: позднее повторяет раннее;
 *   - своё — позднее, готовое — ранее.
 *
 * Кандидатов ищет инвертированный индекс по именам, как в SourcererCC: полный
 * перебор пар на 35 тысячах функций репозитория — это миллиард сравнений.
 *
 * Ничего не зовёт и не стоит денег. Модели — отдельно, `scripts/arbitrate.ts`.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { corpus, relativeTo, type Verdict } from "../src/detect.ts";
import { functionsIn, type FnBody } from "../src/bodies.ts";
import { identifiers, normalize, rareJaccard, lexicalOverlap } from "../src/tokens.ts";
import { absoluteOf, addedAt } from "../src/history.ts";

const EXT = /\.(ts|tsx|js|mjs|cjs|jsx|py|go)$/;
const NOT_SOURCE = /\.(test|spec|d)\.|\.d\.ts$|\.testCases\.|(^|\/)tests?\/|(^|\/)__tests__\/|(^|\/)test_[^/]*\.py$|_test\.go$|(^|\/)conftest\.py$/;
const COPY_DIRS = /(^|\/)(?:\.claude\/worktrees|[^/]*worktrees[^/]*|var\/tmp|[^/]*_backup[^/]*|baseline-src|[^/]*-isolated-check[^/]*)\//;
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", ".git", "coverage", "landing", ".venv", "vendor", ".next",
  "release", "__pycache__", ".mypy_cache", "site", ".cache", ".tox", "target", "dist-electron",
]);

/** Сколько имён должно совпасть, чтобы пара дошла до счёта формы. */
const MIN_SHARED_WORDS = 3;
/** Сколько кандидатов берём с индекса на одну функцию. */
const MAX_CANDIDATES = 400;
const MIN_TOKENS = 40;
const MIN_SHAPE = 0.5;
const MIN_TOPIC = 0.15;

interface Row {
  repo: string;
  own: string;
  ownFile: string;
  ready: string;
  readyFile: string;
  shape: number;
  topic: number;
  tokens: number;
  readyUses: number;
  ownUses: number;
  /**
   * Сколько раз своё имя зовут внутри своего же файла: ноль — написано и
   * брошено совсем, больше — живёт локально.
   */
  ownInner: number;
  /**
   * true — свой файл добавлен раньше готового. Тогда это не велосипед: свою
   * функцию написали первой, а готовая пришла позже и её скопировала.
   */
  ownOlder: boolean | null;
  /**
   * Одно имя у обеих. Сильнее формы: имя совпадает до буквы, даже когда тело
   * разошлось (в подтверждённом случае — веткой `EXDEV` в копии).
   */
  sameName: boolean;
}

interface Scan {
  repo: string;
  files: number;
  functions: number;
  candidates: number;
  pairs: number;
}

function walkSource(root: string): string[] {
  const out: string[] = [];
  const walk = (dirRel: string, depth: number): void => {
    if (depth > 14) return;
    let entries;
    try {
      entries = readdirSync(`${root}/${dirRel}`, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = `${dirRel}/${e.name}`.replace(/^\.\//, "");
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        walk(rel, depth + 1);
        continue;
      }
      if (!EXT.test(e.name)) continue;
      if (NOT_SOURCE.test(e.name) || NOT_SOURCE.test(rel)) continue;
      if (COPY_DIRS.test(rel)) continue;
      out.push(rel);
    }
  };
  walk(".", 0);
  return out;
}

export function scanRepo(repo: string, log: (s: string) => void): { rows: Row[]; scan: Scan } {
  const files = walkSource(repo);
  const found: FnBody[] = [];
  /** Имя → файл объявления. Первый по алфавиту путь: дубли считаются ниже. */
  const declFile = new Map<string, string>();
  /** Имя → {файл: сколько вхождений}. */
  const seen = new Map<string, Map<string, number>>();

  for (const rel of files) {
    let text = "";
    try {
      text = readFileSync(`${repo}/${rel}`, "utf8");
    } catch {
      continue;
    }
    if (text.length > 400_000) continue;
    for (const m of text.matchAll(/\b([A-Za-z_$][\w$]{2,})\b/g)) {
      const name = m[1]!;
      const per = seen.get(name) ?? new Map<string, number>();
      per.set(rel, (per.get(rel) ?? 0) + 1);
      seen.set(name, per);
    }
    for (const fn of functionsIn(text, rel)) {
      found.push(fn);
      if (!declFile.has(fn.name)) declFile.set(fn.name, rel);
    }
  }

  // Тело берём самое длинное на имя В ПРЕДЕЛАХ ФАЙЛА, а не по всему
  // репозиторию.
  //
  // Схлопывание по имени через весь репозиторий стирает ровно тот случай, ради
  // которого сканер и нужен: готовый `renameWithRetrySync` из
  // `src/main/utils/atomicWrite.ts` и своя копия с тем же именем в
  // `agent-teams-controller/src/internal/atomicFile.js` — разные файлы, одно
  // имя. Побеждало длинное тело, копия исчезала из списка, и известный
  // велосипед не находился (замер 2026-11-02: 0 пар на этом месте).
  const byPlace = new Map<string, FnBody>();
  for (const fn of found) {
    const key = `${fn.source}\u0000${fn.name}`;
    const prev = byPlace.get(key);
    if (!prev || fn.body.length > prev.body.length) byPlace.set(key, fn);
  }
  const functions = [...byPlace.values()];
  const c = corpus(functions);

  // Сколько раз имя зовут ВНЕ файла своего объявления.
  //
  // Считать все вхождения минус объявления нельзя: готовый
  // `renameWithRetrySync` зовётся из своего же файла (`renamePathWithRetrySync`),
  // и по такому счёту он «подключён», хотя снаружи не зовётся ни разу — ровно
  // поэтому известный велосипед из него и получился. Мёртвое своё объявлено и
  // не зовётся нигде, поэтому у мёртвого — ноль вне своего файла.
  const uses = new Map<string, number>();
  for (const [name, per] of seen) {
    const own = declFile.get(name);
    let outside = 0;
    for (const [file, n] of per) if (file !== own) outside += n;
    uses.set(name, outside);
  }

  // Дата добавления файла — одна на файл, а не на функцию: `git log` на каждый
  // из 3 650 файлов стоил бы минуты.
  const addedOn = new Map<string, string | null>();
  const addedOf = (rel: string): string | null => {
    if (!addedOn.has(rel)) addedOn.set(rel, addedAt(absoluteOf(repo, rel)));
    return addedOn.get(rel) ?? null;
  };

  // Инвертированный индекс: имя → функции, где оно встречается в теле.
  const index = new Map<string, number[]>();
  for (let i = 0; i < functions.length; i += 1) {
    for (const word of c.words[i]!) {
      const list = index.get(word) ?? [];
      list.push(i);
      index.set(word, list);
    }
  }

  const rows: Row[] = [];
  const total = functions.length;
  for (let i = 0; i < functions.length; i += 1) {
    const me = functions[i]!;
    if (c.tokens[i]!.seq.length < MIN_TOKENS) continue;
    const myDate = addedOf(me.source);
    if (!myDate) continue; // вне git — сравнивать не по чему

    const shared = new Map<number, number>();
    for (const word of c.words[i]!) {
      const list = index.get(word);
      if (!list || list.length > 4000) continue; // слишком общее имя ничего не отбирает
      for (const j of list) {
        if (j === i) continue;
        shared.set(j, (shared.get(j) ?? 0) + 1);
      }
    }
    const candidates = [...shared.entries()]
      .filter(([, n]) => n >= MIN_SHARED_WORDS)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CANDIDATES)
      .map(([j]) => j);

    let best = -1;
    let bestScore = 0;
    let bestTopic = 0;
    for (const j of candidates) {
      const other = functions[j]!;
      if (other.source === me.source) continue;
      if (other.body === me.body) continue;
      // Своё — то, что появилось позже. Раньше быть не может: тогда это не
      // копия, а исходник.
      const otherDate = addedOf(other.source);
      if (!otherDate || otherDate >= myDate) continue;
      const score = rareJaccard(c.tokens[i]!, c.tokens[j]!, c.df, total);
      if (score <= bestScore || score < MIN_SHAPE) continue;
      const topic = lexicalOverlap(c.words[i]!, c.words[j]!);
      if (topic < MIN_TOPIC) continue;
      best = j;
      bestScore = score;
      bestTopic = topic;
    }
    if (best < 0) continue;

    const ready = functions[best]!;
    rows.push({
      repo,
      own: me.name,
      ownFile: me.source,
      ready: ready.name,
      readyFile: ready.source,
      shape: bestScore,
      topic: bestTopic,
      tokens: c.tokens[i]!.seq.length,
      readyUses: uses.get(ready.name) ?? 0,
      ownUses: uses.get(me.name) ?? 0,
      ownInner: (seen.get(me.name)?.get(me.source) ?? 0) - 1,
      ownOlder: false,
      sameName: ready.name === me.name,
    });
  }

  // Второй признак — то же имя в двух файлах, поздний повторяет ранний.
  //
  // Он нужен потому, что форма велосипед не отделяет: в подтверждённом случае
  // `renameWithRetrySync` → `renameWithRetrySync` форма 0,510 — 1334-е место из
  // 1438. Разницу даёт `EXDEV`-ветка в копии, которой в готовом нет. Имя же
  // совпадает до буквы, и это сильнее формы.
  //
  // Замер 2026-11-02: таких пар в agent-teams-ai 137, велосипед среди них.
  const named = new Map<string, number[]>();
  for (let i = 0; i < functions.length; i += 1) {
    if (c.tokens[i]!.seq.length < MIN_TOKENS) continue;
    const list = named.get(functions[i]!.name) ?? [];
    list.push(i);
    named.set(functions[i]!.name, list);
  }
  for (const list of named.values()) {
    if (list.length < 2) continue;
    for (const i of list) {
      const me = functions[i]!;
      const myDate = addedOf(me.source);
      if (!myDate) continue;
      // Одна пара на свою функцию — с самым близким из ранних. Без этого имя,
      // объявленное в десяти файлах, даёт сорок пять пар и топ ими забит.
      let pick = -1;
      let pickScore = 0;
      let pickTopic = 0;
      for (const j of list) {
        if (i === j) continue;
        const other = functions[j]!;
        if (other.source === me.source) continue;
        if (other.body === me.body) continue;
        const otherDate = addedOf(other.source);
        if (!otherDate || otherDate >= myDate) continue;
        const score = rareJaccard(c.tokens[i]!, c.tokens[j]!, c.df, total);
        if (score <= pickScore) continue;
        pick = j;
        pickScore = score;
        pickTopic = lexicalOverlap(c.words[i]!, c.words[j]!);
      }
      if (pick < 0) continue;
      const other = functions[pick]!;
      rows.push({
        repo,
        own: me.name,
        ownFile: me.source,
        ready: other.name,
        readyFile: other.source,
        shape: pickScore,
        topic: pickTopic,
        tokens: c.tokens[i]!.seq.length,
        readyUses: uses.get(other.name) ?? 0,
        ownUses: uses.get(me.name) ?? 0,
        ownInner: (seen.get(me.name)?.get(me.source) ?? 0) - 1,
        ownOlder: false,
        sameName: true,
      });
    }
  }

  // Одно своё тело — одна находка: без этого скрипт, скопированный пять раз,
  // даёт пять одинаковых строк и топ забит им.
  const seenBody = new Set<string>();
  const unique = rows.filter((r) => {
    const key = `${r.own}|${r.ready}|${r.shape.toFixed(3)}`;
    if (seenBody.has(key)) return false;
    seenBody.add(key);
    return true;
  });
  rows.length = 0;
  rows.push(...unique);

  rows.sort((a, b) => b.shape - a.shape);
  log(`  ${repo}: файлов ${files.length}, функций ${functions.length}, пар ${rows.length}`);
  return { rows, scan: { repo, files: files.length, functions: functions.length, candidates: functions.length, pairs: rows.length } };
}

if (import.meta.main) {
  const repos = process.argv.slice(2).filter((a) => existsSync(`${a}/.git`));
  const log = (s: string): void => {
    process.stderr.write(`${s}\n`);
  };
  const rows: Row[] = [];
  const scans: Scan[] = [];
  for (const repo of repos) {
    const r = scanRepo(repo, log);
    rows.push(...r.rows);
    scans.push(r.scan);
  }
  rows.sort((a, b) => b.shape - a.shape || a.repo.localeCompare(b.repo));
  const out = process.env.ANTIBIKE_OUT ?? "antibike-repos.json";
  writeFileSync(out, JSON.stringify({ rows, scans }, null, 1), "utf8");
  console.log(`\nрепозиториев: ${repos.length}, пар: ${rows.length} → ${out}`);
  for (const row of rows.slice(0, 60)) {
    console.log(
      `${row.shape.toFixed(3)} предм ${row.topic.toFixed(2)} ток ${String(row.tokens).padStart(4)} готовое ${String(row.readyUses).padStart(3)}× внутри ${String(row.ownInner).padStart(2)}  ${row.own} → ${row.ready}  [${row.ownFile} vs ${row.readyFile}]  ${row.repo}`,
    );
  }
}
