/**
 * Отбор пар, где готовое можно было импортировать.
 *
 * Из отчёта jscpd берутся межфайловые пары, у которых файлы добавлены в разное
 * время: сторона с более ранней датой — готовая, с поздней — копия.
 *
 * Пара считается дешёвой, если готовый кусок лежит прямым членом именованного
 * объявления (interface / type / class / enum). Такой кусок реюзается словом
 * `export` и строкой `import`. Если готовый кусок лежит в теле функции или в
 * объекте-аргументе вызова, импортировать нечего: нужен вынос в общую функцию
 * с новым именем и правка второго вызова. Автор выбрал первый случай
 * (2026-11-02: «Первое — дешёвый и точный сигнал»).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export interface Clone {
  lines: number;
  tokens: number;
  fragment: string;
  firstFile: { name: string; start: number; end: number };
  secondFile: { name: string; start: number; end: number };
}

export interface ImportableRow {
  lines: number;
  /** Готовый файл и строка — сторона с более ранней датой добавления. */
  ready: string;
  readyLine: number;
  copy: string;
  copyLine: number;
  /** Объявление, в котором лежит готовое: «interface Dependencies». */
  where: string;
  importable: boolean;
}

const DECL = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:interface|type|class|enum)\s+[A-Za-z_$]/;

/** Строка без комментариев и литералов: скобки внутри них не считаются. */
function bare(line: string, state: { inComment: boolean }): string {
  let s = line;
  if (state.inComment) {
    const end = s.indexOf("*/");
    if (end < 0) return "";
    s = s.slice(end + 2);
    state.inComment = false;
  }
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  const open = s.indexOf("/*");
  if (open >= 0) {
    s = s.slice(0, open);
    state.inComment = true;
  }
  return s
    .replace(/\/\/.*$/, "")
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/** Стек блоков, открытых до указанной строки. Внешний блок первым. */
function blocksBefore(lines: string[], line: number): string[] {
  const state = { inComment: false };
  const stack: string[] = [];
  for (let i = 0; i < line - 1; i++) {
    const s = bare(lines[i], state);
    let acc = "";
    for (let k = 0; k < s.length; k++) {
      const ch = s[k];
      if (ch === "{") {
        stack.push(acc.trim());
        acc = "";
      } else if (ch === "}") {
        stack.pop();
        acc = "";
      } else acc += ch;
    }
  }
  return stack;
}

/**
 * Лежит ли строка прямым членом именованного объявления.
 *
 * Ближайший блок над строкой должен быть самим объявлением. «Где-то внутри
 * объявления» мало: код внутри метода класса тоже внутри класса, а
 * импортировать его нельзя.
 */
function directMemberOf(lines: string[], line: number): string | null {
  const stack = blocksBefore(lines, line);
  const nearest = stack.length ? stack[stack.length - 1] : "";
  return DECL.test(nearest) ? nearest : null;
}

/** Когда файл добавлен в git. Пусто — файл вне git или дата неизвестна. */
function addedAt(repo: string, path: string): string {
  try {
    return execFileSync(
      "git",
      ["-C", repo, "log", "-1", "--format=%cI", "--diff-filter=A", "--no-renames", "HEAD", "--", path],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return "";
  }
}

/**
 * Размечает пары отчёта jscpd.
 *
 * `base` — папка прогона от корня репозитория. Пути в отчёте отсчитываются от
 * неё, а не от корня: `<папка>/adapters/x.ts` приходит как `adapters/x.ts`.
 */
export function importableReady(
  report: { duplicates?: Clone[] },
  repo: string,
  base: string,
): ImportableRow[] {
  const scanned = base.replace(/^\/+|\/+$/g, "");
  const clones = (report.duplicates ?? []).filter((c) => c.firstFile.name !== c.secondFile.name);
  const rows: ImportableRow[] = [];

  for (const c of clones) {
    const a = `${scanned}/${c.firstFile.name.split("\\").join("/")}`;
    const b = `${scanned}/${c.secondFile.name.split("\\").join("/")}`;
    const aAt = addedAt(repo, a);
    const bAt = addedAt(repo, b);
    // Без двух дат направление пары не определить.
    if (!aAt || !bAt || aAt === bAt) continue;

    const readyFirst = aAt < bAt;
    const ready = readyFirst ? a : b;
    const readyLine = readyFirst ? c.firstFile.start : c.secondFile.start;
    const copy = readyFirst ? b : a;
    const copyLine = readyFirst ? c.secondFile.start : c.firstFile.start;

    let lines: string[];
    try {
      lines = readFileSync(`${repo}/${ready}`, "utf8").split("\n");
    } catch {
      continue;
    }

    // Смотрим каждую строку куска, а не только первую: jscpd начинает там, где
    // начались токены, и первой может оказаться вложенная скобка. Замер
    // 2026-11-02: кусок с `workSync` начинался строкой `> & {` внутри
    // `Omit<…> & {…}`, и по первой строке пара выпадала.
    const body = (c.fragment ?? "").split("\n");
    let where = "";
    let importable = false;
    for (let i = 0; i < body.length; i++) {
      const direct = directMemberOf(lines, readyLine + i);
      if (direct !== null) {
        importable = true;
        where = direct;
        break;
      }
    }

    rows.push({ lines: c.lines, ready, readyLine, copy, copyLine, where: where.slice(0, 60), importable });
  }

  return rows;
}
