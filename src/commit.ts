/**
 * Велосипеды в одном коммите.
 *
 * Вход — репозиторий и коммит, больше ничего. Выход — пары «что добавлено /
 * где это уже лежало». Список пар снаружи не подаётся: его находит сам детектор.
 *
 * Контекст коммита состоит из двух частей, и обе нужны:
 * - **диф** говорит, какие строки агент добавил;
 * - **всё дерево на родителе** говорит, что уже было готово до правки.
 *
 * Готовое берётся строго из родителя, поэтому «написано раньше» доказывается
 * самим коммитом, а не датами файлов и не поданным извне списком.
 *
 * Единица сравнения — именованный кусок: `interface`, `type`, `class`, `enum`,
 * `function`, стрелочная и член объявления (`workSync: {…}`). Тело берётся по
 * парным скобкам, поэтому копия члена между двумя разными интерфейсами
 * находится: заголовки разные, работа одна.
 */
import { execFileSync } from "node:child_process";

export interface Region {
  /** Имя куска: `workSync`, `Dependencies`, `readActiveLaneIds`. */
  name: string;
  /** Чем объявлен: interface, type, class, enum, function, const, member. */
  kind: string;
  file: string;
  /** Строки 1-основанные, включительно. */
  start: number;
  end: number;
  /** Текст тела без пробелов и переносов: по нему сравниваем. */
  body: string;
  /** Ближайшее объявление сверху: у члена интерфейса — сам интерфейс. */
  enclosing: string;
  /** Лежит ли кусок внутри тела функции, а не в объявлении. */
  inFunction: boolean;
}

export interface Copy {
  /** Добавлено в коммите. */
  added: Region;
  /** Уже лежало в родителе. */
  ready: Region;
}

/** Объявления с именем и телом в скобках. */
const DECL =
  /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(interface|type|class|enum|function)\s+([A-Za-z_$][\w$]*)/;
/** `const f = (...) => {`, `const f = async (x) => {`. */
const ARROW =
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/;
/**
 * Член с телом в скобках: `workSync: {`, `foo: async (x) => {`.
 *
 * Стрелка в объекте-аргументе вызова — тоже велосипед: именно так в разобранной
 * сессии появился `readActiveRuntimeLaneIds`. Поэтому членом считается и
 * `имя: async (…) => {».
 */
const MEMBER_BRACE =
  /^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>\s*)?\{/;

/**
 * Тот же текст, где содержимое комментариев и литералов заменено пробелами.
 *
 * Длина сохраняется посимвольно, поэтому позиции остаются валидными, а скобки
 * внутри строк и комментариев перестают считаться.
 */
export function mask(text: string): string {
  const out = text.split("");
  let i = 0;
  let state: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line";
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        state = "block";
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        state = ch === "'" ? "single" : ch === '"' ? "double" : "template";
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    // Внутри строки или комментария: гасим всё, но переносы оставляем, чтобы
    // номера строк не съехали.
    if (ch === "\n") {
      out[i] = "\n";
      if (state === "line" || state === "single" || state === "double") state = "code";
      i += 1;
      continue;
    }
    if (state === "block" && ch === "*" && next === "/") {
      out[i] = " ";
      out[i + 1] = " ";
      state = "code";
      i += 2;
      continue;
    }
    if (state === "line") {
      out[i] = " ";
      i += 1;
      continue;
    }
    if (ch === "\\") {
      out[i] = " ";
      if (next !== undefined && next !== "\n") out[i + 1] = " ";
      i += 2;
      continue;
    }
    if (
      (state === "single" && ch === "'") ||
      (state === "double" && ch === '"') ||
      (state === "template" && ch === "`")
    ) {
      state = "code";
      i += 1;
      continue;
    }
    out[i] = " ";
    i += 1;
  }
  return out.join("");
}

/**
 * Номер строки по смещению.
 *
 * `newlines[k]` — смещение k-го переноса. Позиция стоит на строке
 * `число переносов до неё + 1`.
 */
function lineAt(newlines: number[], offset: number): number {
  let count = 0;
  for (const nl of newlines) {
    if (nl < offset) count += 1;
    else break;
  }
  return count + 1;
}

/** Позиция парной `}` для `{` на смещении `open`. -1 — не нашлась. */
function matchBrace(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const squeeze = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * Тело с обезличенными идентификаторами.
 *
 * Копия обычно переименовывает вход: `deps.basePath` превращается в
 * `sources.basePath`, и дословного совпадения нет — хотя работа та же. Замер
 * 2026-11-02 на разобранной сессии: ровно так разошлись `readActiveLaneIds`
 * и её копия, единственная разница была в имени параметра.
 *
 * Обезличиваем только строчные идентификаторы: с большой буквы пишут типы и
 * классы, и по ним пара держится.
 */
export function deIdentify(body: string): string {
  return body.replace(/\b[a-z_$][\w$]*\b/g, "id");
}

/**
 * Достаёт именованные куски файла.
 *
 * Кусок — это заголовок `имя` вместе с телом в парных скобках. Телом считается
 * всё внутри скобок: у `interface Dependencies {…}` — его члены, у
 * `workSync: {…}` — две сигнатуры внутри.
 */
export function regionsIn(text: string, file: string): Region[] {
  const masked = mask(text);
  const newlines: number[] = [];
  for (let i = 0; i < masked.length; i++) if (masked[i] === "\n") newlines.push(i);

  const lines = masked.split("\n");
  // Смещение начала каждой строки.
  const offsets: number[] = [];
  let acc = 0;
  for (const line of lines) {
    offsets.push(acc);
    acc += line.length + 1;
  }

  const found: Region[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const base = offsets[i]!;
    let name = "";
    let kind = "";
    let from = -1;
    let body = "";
    let end = i + 1;

    const d = DECL.exec(line);
    const a = d ? null : ARROW.exec(line);
    const m = d || a ? null : MEMBER_BRACE.exec(line);
    if (d) {
      kind = d[1]!;
      name = d[2]!;
      from = base + line.indexOf(d[1]!);
    } else if (a) {
      kind = "const";
      name = a[1]!;
      from = base + line.indexOf("=>");
    } else if (m) {
      kind = "member";
      name = m[1]!;
      from = base + line.indexOf("{", line.indexOf(m[1]!));
    }
    if (from < 0) continue;

    // Смещение конца заголовка: искать `{` раньше нельзя, иначе однострочная
    // стрелка `const f = (x): T => \`…\`;` берёт телом блок следующей функции.
    // Замер 2026-11-02 на agts-merge: `laneKey` и `readActiveLaneIds`
    // оказывались одним куском, и настоящая копия не находилась.
    const lineEnd = base + line.length;
    let open = masked.indexOf("{", from);
    if (open < 0 || open >= lineEnd) {
      // Тело без скобок: остаток строки после стрелки или двоеточия.
      const arrowEnd = masked.indexOf("=>", from);
      body = arrowEnd >= 0 ? masked.slice(arrowEnd + 2, lineEnd) : "";
    } else {
      const close = matchBrace(masked, open);
      if (close < 0) continue;
      body = masked.slice(open + 1, close);
      end = lineAt(newlines, close);
    }

    found.push({
      name,
      kind,
      file,
      start: i + 1,
      end,
      body: squeeze(body),
      enclosing: "",
      inFunction: false,
    });
  }

  // Предок — самый тесный кусок, который накрывает этот и больше его.
  for (const region of found) {
    let best: Region | null = null;
    for (const other of found) {
      if (other === region) continue;
      if (other.start <= region.start && other.end >= region.end) {
        const smaller =
          other.end - other.start < (best ? best.end - best.start : Infinity) ||
          (best !== null && other.end - other.start === best.end - best.start && other.start > best.start);
        if (smaller) best = other;
      }
    }
    region.enclosing = best ? best.name : "";
    // Функция — всё, что не объявление. Тело функции импортировать нечего.
    region.inFunction = best !== null && best.kind === "function";
  }

  return found;
}

/** Запуск git без оболочки и без консольного окна. */
function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
}

/** Родитель коммита. Пусто — коммит корневой, сравнивать не с чем. */
export function parentOf(repo: string, commit: string): string {
  try {
    return git(repo, ["rev-parse", `${commit}^`]).trim();
  } catch {
    return "";
  }
}

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/;

/** Файлы, изменённые коммитом. */
function changedFiles(repo: string, parent: string, commit: string): string[] {
  return git(repo, ["diff", "--name-only", parent, commit])
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s !== "" && SOURCE.test(s));
}

/** Номера добавленных строк по файлу. */
function addedLines(repo: string, parent: string, commit: string, file: string): Set<number> {
  const patch = git(repo, ["diff", "-U0", parent, commit, "--", file]);
  const out = new Set<number>();
  for (const line of patch.split("\n")) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    const from = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i++) out.add(from + i);
  }
  return out;
}

/**
 * Текст файла на коммите. Пусто — файла там нет.
 *
 * Коммит может удалить файл, который диф перечислил: `git show` тогда пишет
 * `fatal: path … does not exist` в stderr. Это не ошибка, поэтому stderr
 * глушим, а пустой ответ считаем отсутствием файла.
 */
function textAt(repo: string, commit: string, file: string): string {
  try {
    return execFileSync("git", ["-C", repo, "show", `${commit}:${file}`], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

/** Самый длинный идентификатор тела: по нему ищем кандидатов в родителе. */
export function anchorOf(body: string): string {
  const words = body.match(/[A-Za-z_$][\w$]{7,}/g) ?? [];
  if (words.length === 0) return "";
  return words.sort((a, b) => b.length - a.length)[0]!;
}

/**
 * Ищет в родителе коммита то, что коммит добавил заново.
 *
 * `minLength` отсекает короткие тела: две-три строки совпадут где угодно и
 * сигналом не являются. `includeInFunction` решает, считать ли копии внутри
 * тела функции: у них реюз дороже (нужен вынос), их автор отложил.
 */
export function copiesInCommit(
  repo: string,
  commit = "HEAD",
  options: { minLength?: number; includeInFunction?: boolean } = {},
): Copy[] {
  const minLength = options.minLength ?? 100;
  const includeInFunction = options.includeInFunction ?? false;
  const parent = parentOf(repo, commit);
  if (parent === "") return [];

  // Что коммит добавил: только куски, чей заголовок стоит на добавленной строке.
  const added: Region[] = [];
  for (const file of changedFiles(repo, parent, commit)) {
    const text = textAt(repo, commit, file);
    if (text === "") continue;
    const touched = addedLines(repo, parent, commit, file);
    for (const region of regionsIn(text, file)) {
      if (!touched.has(region.start)) continue;
      if (region.body.length < minLength) continue;
      if (region.inFunction && !includeInFunction) continue;
      added.push(region);
    }
  }
  if (added.length === 0) return [];

  const copies: Copy[] = [];
  const reported = new Set<string>();
  // Разбор файла родителя нужен и при поиске кандидатов, и при сравнении:
  // без кэша одно дерево разбиралось заново на каждую добавленную строку.
  const regionsCache = new Map<string, (Region & { deIdentified: string })[]>();
  const regionsAt = (file: string): (Region & { deIdentified: string })[] => {
    const known = regionsCache.get(file);
    if (known !== undefined) return known;
    const text = textAt(repo, parent, file);
    const parsed = text === "" ? [] : regionsIn(text, file).map((r) => ({ ...r, deIdentified: deIdentify(r.body) }));
    regionsCache.set(file, parsed);
    return parsed;
  };

  for (const region of added) {
    // Кандидатов сужаем по редкому слову тела; сравниваем всё равно целиком.
    const words = [...new Set(region.body.match(/[A-Za-z_$][\w$]{7,}/g) ?? [])];
    if (words.length === 0) continue;

    const candidates = new Set<string>();
    // Одно слово — самое редкое в теле. Четыре подряд дали бы больше
    // кандидатов, но каждое стоит отдельного обхода дерева: на реальном
    // репозитории это и было узким местом.
    const word = words.sort((a, b) => b.length - a.length)[0]!;
    let listing = "";
    try {
      listing = git(repo, ["grep", "-l", "-F", "-e", word, parent, "--", "*.ts", "*.tsx", "*.js", "*.py"]);
    } catch {
      // git grep возвращает 1, когда совпадений нет.
    }
    for (const hit of listing.split("\n")) {
      const file = hit.slice(hit.indexOf(":") + 1).trim();
      if (file !== "") candidates.add(file);
    }

    for (const file of candidates) {
      // Имя совпадать может и должно: настоящий велосипед часто оставляет
      // прежнее имя. Отсекаем только сам себя — тот же файл и та же строка.
      // Сравниваем и дословно, и с обезличенными именами: копия обычно
      // переименовывает вход, и дословного совпадения тогда нет.
      const wanted = deIdentify(region.body);
      const ready = regionsAt(file).find(
        (other) =>
          !(other.file === region.file && other.start === region.start) &&
          (other.body === region.body || other.deIdentified === wanted),
      );
      if (ready === undefined) continue;
      const key = `${region.file}\u0000${region.name}\u0000${file}\u0000${ready.name}`;
      if (reported.has(key)) continue;
      reported.add(key);
      copies.push({ added: region, ready });
      break;
    }
  }

  // Одна копия не должна отчитываться дважды. Обезличивание делает похожими и
  // внешний интерфейс, и вложенный блок внутри него; читателю нужен более
  // точный адрес, поэтому внешнее совпадение выбрасываем.
  return copies.filter(
    (candidate) =>
      !copies.some(
        (other) =>
          other !== candidate &&
          other.ready.file === candidate.ready.file &&
          other.ready.start >= candidate.ready.start &&
          other.ready.end <= candidate.ready.end &&
          (other.ready.end - other.ready.start) < (candidate.ready.end - candidate.ready.start),
      ),
  );
}
