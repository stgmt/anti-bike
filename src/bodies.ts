/**
 * Тела функций целиком: без этого сравнивать нечего.
 *
 * Прошлая ветка брала 1500 знаков от объявления — туда попадал соседний код,
 * и сравнение шло по мусору. Здесь тело вырезается по балансу скобок.
 */

export interface FnBody {
  name: string;
  /** Тело без объявления: только то, что функция делает. */
  body: string;
  /** Откуда взято: файл или вызов. */
  source: string;
  /** Форма для модели: «принимает → делает → возвращает». */
  shape: string;
}

const HEAD = /(?:^|\n)[ \t]*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|def)\s+([A-Za-z_$][\w$]*)\s*(\([^)]*\))?/g;
const ASSIGNED = /(?:^|\n)[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(\([^)]*\))\s*(?::[^=]+)?=>/g;
/**
 * Класс целиком.
 *
 * Без этого разбор терял велосипеды-классы: в окне tokenplan так пропала
 * `TeamOperationQueue` — своя очередь при готовой. Класс описывается тем же
 * «задача / вход / выход», только роль играют его методы.
 */
const CLASS = /(?:^|\n)[ \t]*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g;

/**
 * Вырезает тело по балансу фигурных скобок.
 *
 * Без баланса тело обрывается на первой же `}` внутри — у функций с вложенным
 * блоком остаётся четверть кода, и сравнение по смыслу врёт.
 */
export function bodyAfter(text: string, from: number): string {
  const open = text.indexOf("{", from);
  if (open < 0) {
    // Тело по отступам: так пишут Python. Скобочный баланс здесь не работает —
    // у питоновской функции нет фигурных скобок, и прежний код возвращал
    // одну строку `def ...:`, то есть объявление вместо тела.
    const indentBody = bodyByIndent(text, from);
    if (indentBody !== null) return indentBody;
    const lineEnd = text.indexOf("\n", from);
    return text.slice(from, lineEnd < 0 ? text.length : lineEnd).trim();
  }
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i).trim();
    }
  }
  return text.slice(open + 1, Math.min(text.length, open + 3000)).trim();
}

/**
 * Тело функции по отступам — для языков без фигурных скобок.
 *
 * Возвращает null, если строка объявления не заканчивается двоеточием: тогда
 * это не питон и решает скобочный баланс.
 */
export function bodyByIndent(text: string, from: number): string | null {
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const head = text.slice(lineStart, text.indexOf("\n", from) < 0 ? text.length : text.indexOf("\n", from));
  if (!head.trimEnd().endsWith(":")) return null;
  const baseIndent = head.length - head.trimStart().length;
  const lines = text.slice(text.indexOf("\n", from) + 1).split("\n");
  const body: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      body.push(line);
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent <= baseIndent) break;
    body.push(line.slice(Math.min(indent, baseIndent + 4)));
  }
  return body.join("\n").trim();
}

/**
 * Описание формы функции словами.
 *
 * Сравнивать чистый код через эмбеддинги мешает синтаксис: `return x` и
 * `=> x` далеко друг от друга по токенам. Форма убирает разметку и оставляет
 * занятия: что принимает, что зовёт, что возвращает.
 */
export function shapeOf(params: string, body: string): string {
  const calls = [...new Set([...body.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1]))]
    .filter((n) => !["if", "for", "while", "switch", "catch", "return", "function", "await", "new", "typeof"].includes(n))
    .slice(0, 12);
  const paramsClean = params.replace(/[{}[\]:]/g, " ").replace(/\w+:\s*/g, "").replace(/\s+/g, " ").trim();
  const keywords = [...new Set((body.match(/[a-z]+[A-Z][a-zA-Z]*|[A-Z][a-z]+[A-Za-z]*/g) ?? []))]
    .filter((w) => w.length > 4).slice(0, 14);
  return `принимает: ${paramsClean.slice(0, 160)} | зовёт: ${calls.join(", ")} | о чём: ${keywords.join(", ")}`;
}

/** Все функции из куска кода. */
export function functionsIn(code: string, source: string): FnBody[] {
  // Два формата с префиксом: ответ ripgrep «путь:строка:» и ответ Read
  // «   123→» (cat -n с табуляцией). Без снятия второго разбор по Read
  // находил 0 функций из 1041 прочитанного файла.
  const clean = code.replace(/^[^\n:]+:\d+:/gm, "").replace(/^\s*\d+\t/gm, "");
  const found: FnBody[] = [];
  // Класс — первым: его тело длиннее методов, и при схлопывании по имени
  // побеждает именно тело класса.
  for (const pattern of [CLASS.source, HEAD.source, ASSIGNED.source]) {
    const re = new RegExp(pattern, "g");
    let m = re.exec(clean);
    while (m !== null) {
      const name = m[1];
      const at = re.lastIndex;
      if (name && name.length >= 3) {
        const body = bodyAfter(clean, at);
        // Короткое тело — обычно обёртка или геттер: сравнивать по смыслу
        // нечего. Отсев по пустоте, а не по длине: у настоящей проверки
        // бывает тридцать знаков.
        // Мелкие геттеры и обёртки шумят: замер дал их в топе margin, где
        // должен был стоять велосипед. Сравнивать имеет смысл то, у чего
        // есть несколько шагов и хотя бы две строки.
        // Порог по шагам снят для классов и коротких функций с одним вызовом:
        // своя очередь в окне tokenplan — тело 359 знаков и один вызов
        // previous.then, и отсев по шагам выкидывал её из сравнения.
        const steps = (body.match(/[;\n]/g) ?? []).length;
        if (body.length >= 60) found.push({ name, body, source, shape: shapeOf(m[2] ?? "", body) });
      }
      m = re.exec(clean);
    }
  }
  // Одно имя — одно тело: побеждает самое длинное, у него больше смысла.
  const best = new Map<string, FnBody>();
  for (const fn of found) {
    const prev = best.get(fn.name);
    if (!prev || fn.body.length > prev.body.length) best.set(fn.name, fn);
  }
  return [...best.values()];
}
