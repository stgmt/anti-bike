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
 * Стрелочная функция с любым хвостом.
 *
 * `ASSIGNED` требует параметров в скобках, поэтому `const normalize = (text) => …`
 * он находил, а `const f = x => …` и однострочные тела — нет. Замер на
 * `hook-shim.mjs`: короткая стрелочная не попадала в сравнение вовсе.
 */
const ARROW = /(?:^|\n)[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g;

/**
 * Метод класса и декораторы Pydantic: `    def coverage(self) -> …:`.
 *
 * `HEAD` требует начала строки без отступа, поэтому методы с отступом не
 * находились. Замер: `coverage` из `rendered_video_critic.py` попадал в
 * сравнение только потому, что разбирался текст СКРИПТА ПРАВКИ, а не метода.
 */
const METHOD = /(?:^|\n)[ \t]+(?:@[A-Za-z_.]+\s*\n\s*)*(?:async\s+)?def\s+([A-Za-z_$][\w$]*)\s*(\([^)]*\))?/g;

/**
 * Скрипт правки файла — не код приложения.
 *
 * Окна часто пишут питон, который правит другой файл строками. Тела функций
 * в нём — куски чужого исходника в литералах, и сравнение с готовым даёт
 * ложные пары. Замер 2026-11-02: так в находки попал `coverage` из
 * `tmp/t15_d.py`, где он лежал строкой внутри вызова `edit(...)`.
 */
const PATCH_SCRIPT =
  /(^|\n)\s*(?:from\s+edit_util\s+import|import\s+edit_util)|(^|\n)[ \t]*edit\(|(^|\n)[ \t]*(?:with\s+)?open\([^)\n]*["'][wa]|(^|\n)\s*(?:pathlib\.)?Path\([^)\n]*\)\.write_text/;

/**
 * Вырезает тело по балансу фигурных скобок.
 *
 * Без баланса тело обрывается на первой же `}` внутри — у функций с вложенным
 * блоком остаётся четверть кода, и сравнение по смыслу врёт.
 */
export function bodyAfter(text: string, from: number): string {
  // Однострочная стрелочная функция: тело — остаток строки. Без этой ветки
  // `const normalize = (t) => t.trim();` получало телом следующую функцию
  // целиком: поиск `{` уходил за конец строки. Замер на `hook-shim.mjs`:
  // из-за этого `normalize` сравнивался как `shimDigest`, и в находки попала
  // пара, которой нет.
  // Проверяем то, что стоит ПЕРЕД `from`: разбор уже съел `=>`, и в остатке
  // строки его нет.
  const lineEnd0 = text.indexOf("\n", from);
  const before = text.slice(Math.max(0, from - 4), from);
  const sameLine = text.slice(from, lineEnd0 < 0 ? text.length : lineEnd0);
  if (before.includes("=>") && !sameLine.includes("{")) return sameLine.trim();

  // Python — раньше скобочного баланса. Заголовок `def f(x):` кончается
  // двоеточием, а `{` в теле бывает словарём: `{"admissionId": …}`. Прежний
  // порядок находил эту скобку и вырезал по балансу кусок словаря — тело
  // выходило не функцией, а одним литералом. Замер 2026-11-02: в
  // `reel_transition_edit.py` так исчезло тело у ВСЕХ 13 функций, и пара
  // `_image` → `_pin_plan` со сходством 1,000 оказалась сравнением двух
  // одинаковых фрагментов словаря, а не работ.
  const indentBody = bodyByIndent(text, from);
  if (indentBody !== null) return indentBody;

  const open = text.indexOf("{", from);
  if (open < 0) {
    // Без `def` и без `{` тела нет: остаток строки годится только как
    // последняя надежда, и возвращать его целиком нельзя — так в тело
    // попадает соседний код.
    return "";
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
  // `async def boundary(self, ...): ...` — заглушка протокола. Тело пустое, и
  // признак двоеточия стоит перед многоточием, а не в конце строки. Без этой
  // ветки заглушка проваливалась к поиску `{` и получала телом первый словарь
  // из соседнего метода: тринадцать портов сравнивались одним и тем же
  // литералом `{"admissionId": …}` (замер 2026-11-02).
  const tail = head.trimEnd();
  if (tail.endsWith(": ...") || tail === "...") return "";
  if (!tail.endsWith(":")) return null;
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
  // Скрипт правки не разбираем: в нём тела функций чужого файла лежат
  // строками, и сравнение с готовым даёт пары, которых нет в приложении.
  if (PATCH_SCRIPT.test(clean)) return [];
  const found: FnBody[] = [];
  // Класс — первым: его тело длиннее методов, и при схлопывании по имени
  // побеждает именно тело класса.
  for (const pattern of [CLASS.source, HEAD.source, METHOD.source, ARROW.source]) {
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
