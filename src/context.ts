/**
 * Список готового: что уже умеет проект и установленные библиотеки.
 *
 * Замеры 2026-11-01, один и тот же ход `[20252]`, Drex-Max, порог 0,5:
 *
 *   без списка                                   0,049  промах
 *   модули пакета, 40 штук                       0,108  промах
 *   модули плюс библиотеки                       0,077  промах
 *   имена импортов, 10 библиотек                 0,030  промах
 *   механизмы с описанием, 720 символов          0,951  верно
 *
 * Корень: модели нужно не «что импортировано», а **что механизм умеет**.
 * `context_schema` — параметр `StateGraph`, а не имя импорта: в списке имён его
 * нет, поэтому предложение «введу объект для зависимостей» не с чем сверить.
 *
 * Поэтому список собирается из трёх источников, в порядке полезности:
 *  1. описание механизмов из docstring установленных пакетов;
 *  2. имена, которые проект берёт (как подсказка, что именно он использует);
 *  3. версии, чтобы модель знала, о какой версии речь.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface Imported {
  /** Имя установленной библиотеки. */
  library: string;
  /** Имена, которые проект из неё берёт. */
  names: string[];
}

export interface ReadyContext {
  imports: Imported[];
  /** Описания механизмов из docstring пакетов. */
  mechanisms: { library: string; name: string; purpose: string }[];
  /** Готовый текст для модели. */
  markdown: string;
  /** Сколько символов попало в текст: длинный список размывает ответ. */
  size: number;
}

/** Имена, которые не несут смысла механизма: типы, исключения, служебное. */
const NOISE =
  /^(Any|Optional|Union|Literal|TypedDict|Protocol|Callable|Awaitable|Sequence|Mapping|Path|Decimal|datetime|timedelta|\(|\)|__future__)$/;

/**
 * Имена, которые сами по себе не говорят, что умеет библиотека.
 *
 * Замер 2026-11-01: список, куда попали `NULL_TASK_ID`, `RESUME`, `END`, `START`
 * и `operator.itemgetter`, дал на настоящем велосипеде 0,028 вместо 0,89.
 * Механизм — это то, чем библиотека что-то делает: класс, функция, middleware.
 * Константы и перечисления механизмом не являются.
 */
const CONSTANT = /^[A-Z][A-Z0-9_]+$/;

/** Библиотеки, которые в проекте только ради типов или служебных нужд. */
const IGNORED = new Set(["types", "typing_extensions", "operator", "contextvars", "difflib"]);

/** Стандартная библиотека: её механизмы модель знает без списка. */
const STDLIB = new Set([
  "__future__", "abc", "argparse", "asyncio", "base64", "collections", "contextlib", "copy",
  "csv", "dataclasses", "datetime", "decimal", "enum", "functools", "hashlib", "html", "io",
  "itertools", "json", "logging", "math", "os", "pathlib", "random", "re", "shutil", "signal",
  "sqlite3", "string", "subprocess", "sys", "tempfile", "textwrap", "time", "typing",
  "unicodedata", "urllib", "uuid", "warnings", "zipfile",
]);

/** Собирает импорты из всех `.py` под путём. */
async function collectImports(dir: string, into: Map<string, Set<string>>): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "__pycache__") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectImports(full, into);
      continue;
    }
    if (!entry.name.endsWith(".py") || entry.name.startsWith("test_")) continue;
    const text = await readFile(full, "utf8");
    // `from x.y import a, b` и `import x`
    for (const match of text.matchAll(/^from\s+([\w.]+)\s+import\s+\(?([^\n)]+)\)?/gm)) {
      const library = match[1].split(".")[0];
      if (STDLIB.has(library) || IGNORED.has(library) || library.startsWith("carousel")) continue;
      const names = match[2]
        .split(",")
        .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
        .filter((name) => name.length > 0)
        .filter((name) => !NOISE.test(name) && !CONSTANT.test(name));
      if (names.length === 0) continue;
      const bucket = into.get(library) ?? new Set<string>();
      for (const name of names) bucket.add(name);
      into.set(library, bucket);
    }
  }
}

/** Версии библиотек из `uv.lock`. */
export async function readVersions(lockPath: string): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  let text: string;
  try {
    text = await readFile(lockPath, "utf8");
  } catch {
    return versions;
  }
  for (const block of text.split("[[package]]")) {
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(block);
    const version = /^\s*version\s*=\s*"([^"]+)"/m.exec(block);
    if (name && version) versions.set(name[1].toLowerCase(), version[1]);
  }
  return versions;
}

/** Сколько имён на библиотеку включать: длинный список размывает ответ. */
const MAX_NAMES = 12;

/** Сколько механизмов описывать: дальше список размывает ответ. */
const MAX_MECHANISMS = 22;

/** Где лежат установленные пакеты: venv проекта. */
const SITE_PACKAGES = [
  "E:/repos/carousel-demo/.venv/Lib/site-packages",
  "E:/repos/carousel-demo/.venv/lib/python3.12/site-packages",
];

/**
 * Первая часть docstring класса или функции.
 *
 * Докстринг — единственное место, где сказано, что механизм умеет. Описания
 * в каталогах пакетов для этого не годятся: их нет локально.
 *
 * Поиск построчный, а не одной регуляркой на весь пакет. Мегарегулярка с
 * ленивым `[\s\S]{0,2000}?` не находила `StateGraph`, `Runtime`, `interrupt` и
 * `AsyncSqliteSaver` на 1,5 МБ исходников, хотя каждый класс на месте: ленивый
 * обход назад по 2000 символов на каждое вхождение слишком хрупок.
 */
function describeFromDocstring(source: string, name: string): string {
  const declaration = new RegExp(`^\\s*(?:class|def)\\s+${name}\\b`, "m");
  const found = declaration.exec(source);
  if (!found) return "";

  // От объявления вперёд ищем открывающую кавычку docstring.
  const rest = source.slice(found.index + found[0].length);
  const open = /("""|''')/.exec(rest);
  if (!open) return "";
  const bodyStart = open.index + open[0].length;
  const close = rest.indexOf(open[0], bodyStart);
  if (close === -1) return "";

  const body = rest.slice(bodyStart, close);
  // Первый абзац до пустой строки, не длиннее 200 символов.
  const first = body.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  return first.slice(0, 200);
}

/** Сколько описывать от одной библиотеки за круг. */
const PER_LIBRARY = 3;

/**
 * Описания механизмов из установленных пакетов.
 *
 * Круг за кругом по всем библиотекам, а не подряд по одной. Подряд не работало:
 * `pydantic` с двенадцатью именами занимал все слоты, и до `langgraph` очередь
 * не доходила — в списке не было `StateGraph`, `Runtime` и `interrupt`, модель
 * отвечала 0,03 вместо 0,95.
 *
 * Внутри библиотеки сначала классы: класс — механизм, перечисление или тип — нет.
 */
async function describeMechanisms(
  imports: { library: string; names: string[] }[],
): Promise<{ library: string; name: string; purpose: string }[]> {
  const prepared: { library: string; names: string[]; source: string }[] = [];
  for (const entry of imports) {
    const packageDir = await resolvePackage(entry.library);
    if (!packageDir) continue;
    const source = await readPackageSource(packageDir);
    if (source === "") continue;
    const names = [...entry.names].sort((left, right) => {
      const leftClass = /^[A-Z]/.test(left) ? 0 : 1;
      const rightClass = /^[A-Z]/.test(right) ? 0 : 1;
      return leftClass - rightClass;
    });
    prepared.push({ library: entry.library, names, source });
  }

  const found: { library: string; name: string; purpose: string }[] = [];
  const taken = new Map<string, number>();
  let progressed = true;
  while (progressed && found.length < MAX_MECHANISMS) {
    progressed = false;
    for (const entry of prepared) {
      if (found.length >= MAX_MECHANISMS) break;
      const already = taken.get(entry.library) ?? 0;
      const next = entry.names[already];
      if (next === undefined) continue;
      taken.set(entry.library, already + 1);
      progressed = true;
      const purpose = cleanDocstring(describeFromDocstring(entry.source, next));
      if (purpose.length > 20) found.push({ library: entry.library, name: next, purpose });
    }
  }
  return found;
}

/**
 * Чистит докстринг от разметки документации.
 *
 * У `pydantic` докстринги начинаются с `!!! abstract "Usage Documentation"` и
 * ссылок на .md: в списке готового это мусор, модель по нему ничего не сверит.
 */
function cleanDocstring(purpose: string): string {
  if (purpose.startsWith("!!!") || purpose.includes("../concepts/")) {
    // Берём первый осмысленный абзац после разметки.
    const lines = purpose.split(/(?<=\.)\s+/).filter((line) => !line.startsWith("!!!") && !line.includes("../"));
    return lines.join(" ").trim();
  }
  return purpose;
}

/** Каталог установленного пакета. */
async function resolvePackage(library: string): Promise<string | null> {
  for (const root of SITE_PACKAGES) {
    for (const candidate of [library, library.replaceAll("-", "_")]) {
      try {
        const entries = await readdir(join(root, candidate));
        if (entries.length > 0) return join(root, candidate);
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Весь `.py` пакета одной строкой: нужен для поиска docstring.
 *
 * Потолка по числу файлов нет нарочно. У `langgraph` 110 файлов, и нужные
 * (`graph/state.py`, `runtime.py`, `types.py`, `checkpoint/sqlite/aio.py`) попадают
 * в конец алфавитного обхода. Потолок 120 отрезал их: в списке не было ни
 * `StateGraph`, ни `Runtime`, ни `interrupt`, и модель отвечала 0,03.
 * Чтение 1,5 МБ занимает десятки миллисекунд, экономить тут нечего.
 */
async function readPackageSource(dir: string, files: string[] = [], depth = 0): Promise<string> {
  if (depth > 6) return "";
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return "";
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".py")) {
      files.push(full);
    } else if (entry.isDirectory() && !entry.name.startsWith("__") && !entry.name.startsWith(".")) {
      await readPackageSource(full, files, depth + 1);
    }
  }
  if (depth > 0) return "";
  const parts: string[] = [];
  for (const path of files) {
    try {
      parts.push(await readFile(path, "utf8"));
    } catch {
      continue;
    }
  }
  return parts.join("\n");
}

/**
 * Собирает список готового.
 *
 * Порядок важен: сначала то, что проект реально импортирует, потом версия.
 * Библиотеки без версии в lock-файле всё равно попадают: имя механизма полезнее версии.
 */
export async function buildReadyContext(
  packageDir: string,
  lockPath: string,
): Promise<ReadyContext> {
  const found = new Map<string, Set<string>>();
  await collectImports(packageDir, found);
  const versions = await readVersions(lockPath);

  const imports: Imported[] = [...found.entries()]
    .map(([library, names]) => ({ library, names: [...names].slice(0, MAX_NAMES) }))
    .sort((left, right) => right.names.length - left.names.length);

  const mechanisms = await describeMechanisms(imports);

  const lines: string[] = ["Что уже есть в проекте и в установленных библиотеках:"];
  if (mechanisms.length > 0) {
    lines.push("\nМеханизмы, которые проект использует:");
    let current = "";
    for (const entry of mechanisms) {
      if (entry.library !== current) {
        const version = versions.get(entry.library.toLowerCase());
        lines.push(`- ${version ? `${entry.library} ${version}` : entry.library}:`);
        current = entry.library;
      }
      lines.push(`  * ${entry.name} — ${entry.purpose}`);
    }
  }
  const markdown = lines.join("\n");
  return { imports, mechanisms, markdown, size: markdown.length };
}
