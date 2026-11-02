/**
 * Токенная нормализация для поиска клонов Type-2 и Type-3.
 *
 * Почему не jscpd: jscpd сравнивает последовательности токенов дословно. Замер
 * 2026-11-02 на подтверждённом велосипеде `atomicFile.js` против готового
 * `atomicWrite.ts` — ноль перекрёстных совпадений, хотя обе функции делают одно:
 * повторяют `rename` на EPERM/EACCES/EBUSY и ждут через `Atomics.wait`.
 * Причина: имена другие (`renameWithRetrySync` против `renameWithRetry`,
 * `getRenameRetryDelayMs` против `RENAME_PUBLISH_RETRY.delayMs`), а jscpd
 * видит разные токены.
 *
 * Приём взят у SourcererCC (arXiv 1512.06448): токены сводятся к классам —
 * имя, литерал, ключевое слово, знак. Тогда переименование не мешает, а
 * структура остаётся. Сравнение — по пересечению множеств токенов
 * (коэффициент Жаккара), как в инвертированном индексе SourcererCC.
 */

/** Ключевые слова, которые несут структуру и потому остаются как есть. */
const KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "return",
  "try", "catch", "finally", "throw", "new", "delete", "typeof", "instanceof", "in", "of",
  "function", "class", "const", "let", "var", "async", "await", "yield", "import", "export",
  "from", "extends", "implements", "interface", "type", "enum", "public", "private", "protected",
  "static", "readonly", "this", "super", "null", "undefined", "true", "false", "void",
  "def", "lambda", "with", "as", "pass", "raise", "not", "and", "or", "is", "none", "true",
]);

export interface Tokens {
  /** Нормализованная последовательность: структура без имён. */
  seq: string[];
  /** Множество для коэффициента Жаккара. */
  set: Set<string>;
  /** Кратности: сколько раз токен встретился. */
  count: Map<string, number>;
}

const WORD = /[A-Za-z_$][\w$]*/g;
const NUMBER = /\b\d+(?:\.\d+)?\b/g;

/**
 * Токены кода в нормализованном виде.
 *
 * Имена → `ID`, числа и строки → `LIT`, ключевые слова и знаки остаются.
 * Так `renameWithRetrySync(tmp, dest)` и `renameWithRetry(src, dest)`
 * дают одинаковую последовательность.
 */
export function normalize(code: string): Tokens {
  // Строки и комментарии убираем до разбора: их содержимое — не структура,
  // а длинный литерал между двумя `+` искажает пересечение.
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:\\.|[^`\\])*`/g, ' "LIT" ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' "LIT" ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' "LIT" ');

  const tokens: string[] = [];
  const pattern = /([A-Za-z_$][\w$]*)|(\d+(?:\.\d+)?)|([=!<>+\-*/%&|^~?:;,()[\]{}.#]+)/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(stripped)) !== null) {
    const word = m[1];
    if (word !== undefined) {
      tokens.push(KEYWORDS.has(word) ? word : "ID");
      continue;
    }
    if (m[2] !== undefined) {
      tokens.push("LIT");
      continue;
    }
    const op = m[3]!;
    // Одиночные скобки и точки несут структуру блока — оставляем. Пробелы нет.
    tokens.push(op);
  }
  const seq = tokens.filter((t) => t !== " " && t !== "");
  const count = new Map<string, number>();
  for (const t of seq) count.set(t, (count.get(t) ?? 0) + 1);
  return { seq, set: new Set(seq), count };
}

/**
 * Взвешенный Жаккар с кратностями: пересечение считается по минимуму
 * кратностей, объединение — по максимуму.
 *
 * Почему не по множеству: замер на `agent-teams-ai` (13 100 функций) дал
 * 11 ложных на пороге 1,000. Причина — короткие тела из двух-трёх
 * конструкций: множество токенов у них целиком содержится в любом другом
 * теле, и жаккар равен единице. Кратности возвращают объём: функция из
 * одного оператора и функция из двадцати перестают быть равными.
 */
export function weightedJaccard(a: Tokens, b: Tokens): number {
  let inter = 0;
  let union = 0;
  for (const [token, n] of a.count) {
    const m = b.count.get(token) ?? 0;
    inter += Math.min(n, m);
    union += Math.max(n, m);
  }
  for (const [token, m] of b.count) {
    if (!a.count.has(token)) union += m;
  }
  if (union === 0) return 0;
  return inter / union;
}

/**
 * Взвешенный Жаккар, где вес токена падает с его частотой в корпусе.
 *
 * Причина: замер на `agent-teams-ai` дал 70 находок при пороге формы 0,65,
 * и все — шум. Токены `if`, `return`, `(`, `)`, `{`, `}` есть в каждом теле,
 * поэтому два любых обработчика совпадают по форме. Редкий токен —
 * `.rename` вместе с `Atomics.wait` — в корпусе почти не встречается и потому
 * весит. Это IDF из SourcererCC (arXiv 1512.06448).
 *
 * `df` — сколько функций корпуса содержат токен. Вес = log(всего / df).
 */
export function rareJaccard(a: Tokens, b: Tokens, df: Map<string, number>, total: number): number {
  if (total === 0) return 0;
  const weight = (token: string): number => {
    const seen = df.get(token) ?? 0;
    if (seen === 0) return 0;
    return Math.log(total / seen);
  };
  let inter = 0;
  let union = 0;
  for (const [token, n] of a.count) {
    const m = b.count.get(token) ?? 0;
    const w = weight(token);
    inter += w * Math.min(n, m);
    union += w * Math.max(n, m);
  }
  for (const [token, m] of b.count) {
    if (!a.count.has(token)) union += weight(token) * m;
  }
  if (union === 0) return 0;
  return inter / union;
}

/** Идентификаторы, которые в коде что-то значат: слова, не ключевые. */
export function identifiers(code: string): Set<string> {
  const out = new Set<string>();
  for (const m of code.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const word = m[0];
    if (word.length < 4) continue;
    if (KEYWORDS.has(word)) continue;
    out.add(word.toLowerCase());
  }
  return out;
}

/**
 * Пересечение словаря двух кусков кода.
 *
 * Структура без имён отвечает на вопрос «та же форма?», но не «та же
 * предметная область?». Замер на подтверждённом велосипеде: посторонняя
 * функция дала взвешенный жаккар 0,669 против 0,645 у настоящей пары — форма
 * у обеих одинаковая. Имена возвращают предмет: `rename`, `retry`, `ebusy`
 * против `coordination`, `reliability`.
 */
export function lexicalOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let common = 0;
  for (const w of small) if (large.has(w)) common += 1;
  return common / small.size;
}

/** Коэффициент Жаккара по множествам токенов: пересечение / объединение. */
export function jaccard(a: Tokens, b: Tokens): number {
  if (a.set.size === 0 || b.set.size === 0) return 0;
  let common = 0;
  const [small, large] = a.set.size <= b.set.size ? [a.set, b.set] : [b.set, a.set];
  for (const t of small) if (large.has(t)) common += 1;
  return common / (a.set.size + b.set.size - common);
}

/**
 * Доля общих токенов от меньшего множества.
 *
 * Жаккар наказывает за разный объём: маленькая функция внутри большой даёт
 * низкий балл, хотя вся её структура там есть. Велосипед часто и выглядит как
 * урезанная копия, поэтому основной счёт — containment, а Жаккар рядом.
 */
export function containment(a: Tokens, b: Tokens): number {
  if (a.set.size === 0 || b.set.size === 0) return 0;
  const [small, large] = a.set.size <= b.set.size ? [a.set, b.set] : [b.set, a.set];
  let common = 0;
  for (const t of small) if (large.has(t)) common += 1;
  return common / small.size;
}

/**
 * Похожесть последовательностей: наибольшая общая подпоследовательность
 * токенов, нормированная на меньшую длину.
 *
 * Множество токенов теряет порядок, и «сортировка плюс проверка» становится
 * неотличима от «проверка плюс сортировка». Порядок возвращает эту разницу.
 */
export function orderSimilarity(a: Tokens, b: Tokens): number {
  const [short, long] = a.seq.length <= b.seq.length ? [a.seq, b.seq] : [b.seq, a.seq];
  if (short.length === 0) return 0;
  // Общая подпоследовательность динамикой: длины до 2000 токенов это 4 млн
  // ячеек, памяти много. Режем длинное до 1200 — дальше структура повторяется.
  const s = short.slice(0, 1200);
  const l = long.slice(0, 1200);
  const prev = new Uint16Array(l.length + 1);
  const cur = new Uint16Array(l.length + 1);
  for (let i = 1; i <= s.length; i += 1) {
    for (let j = 1; j <= l.length; j += 1) {
      cur[j] = s[i - 1] === l[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    }
    prev.set(cur);
  }
  return prev[l.length]! / s.length;
}
