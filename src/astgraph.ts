/**
 * AST-граф зависимостей: RepoReuse для транскриптов агента.
 *
 * Источник — статья «Do Coding Agents Reuse Existing Code or Reinvent the
 * Wheel?» (arXiv 2609.35357, сентябрь 2026). Её метрика reuse:
 *
 *   reuse = доля готовых целей, которые агент ВЫЗВАЛ.
 *   написал свою логику, а готовую не вызвал — это переписывание.
 *
 * Почему это, а не список готового: в статье показано, что показ агенту
 * готового кода почти не помогает («seeing is not using»). Узкое место не
 * доступ к информации, а решение строить своё. Слова агента тут тоже не нужны:
 * замер по сессии tokenplan — велосипед построен с нулём текстовых блоков,
 * только вызовами инструментов.
 *
 * Что строим:
 *   1. Объявления из окна работы: тело из Write/Edit, из кода ctx_execute и из
 *      оболочек (python/sed heredoc).
 *   2. Вызовы из того же окна: каждое имя, за которым стоит «(».
 *   3. Отдельно — готовое: объявления, которые были в проекте ДО окна.
 *
 * Велосипед — новое объявление, которого не было до окна, и которое ни разу
 * не вызывается как готовое. Проверяется без модели.
 */

/** Объявление, найденное в окне. */
export interface Decl {
  name: string;
  /** Откуда: файл, оболочка или вызов инструмента. */
  source: string;
  /** Тело целиком: нужно, чтобы понять, что делает. */
  body: string;
  /** Вид: class, fn, assign. */
  kind: "class" | "fn" | "assign";
}

/** Идентификаторы, которые называет окно. */
export interface Graph {
  declared: Decl[];
  /** Всё, за чем в окне стоит скобка: вызов, а не упоминание. */
  called: Set<string>;
  /** Имена, которые окно читало: Read/Grep/Glob по этим словам. */
  read: Set<string>;
  /** Сколько раз имя вызвано ВНЕ куска, где оно объявлено. */
  outside: Map<string, number>;
}

const DECLARATION = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|interface|function|def|struct|enum)\s+([A-Za-z_$][\w$]*)|(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function)/g;

/** Имена, короткие настолько, что совпадение по скобке ничего не значит. */
const TOO_COMMON = new Set(["if", "for", "while", "switch", "catch", "return", "function", "typeof", "await", "new", "else", "do", "try"]);

/**
 * Объявления из куска кода.
 *
 * Берём только реальные объявления: имя после class/function/def или
 * присваивание функции. Просто упоминание имени в тексте объявлением не
 * считается — на этом прошлая ветка и попадала в ложные.
 */
export function declarationsIn(code: string, source: string): Decl[] {
  const out: Decl[] = [];
  // Ответ ripgrep начинается с «путь:строка:», и объявление оказывается не в
  // начале строки. Замер: на ответе rg разбор находил 0 объявлений из тысячи,
  // и проверка reuse молчала. Снимаем префикс до разбора.
  const clean = code.replace(/^[^\n:]+:\d+:/gm, "");
  DECLARATION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DECLARATION.exec(clean)) !== null) {
    const name = match[1] ?? match[2];
    if (!name || name.length < 3) continue;
    const start = match.index;
    // Тело до следующего объявления или до конца куска: по нему видно, что делает.
    const next = code.indexOf("\n", DECLARATION.lastIndex);
    out.push({
      name,
      source,
      body: clean.slice(start, Math.min(clean.length, start + 1500)),
      kind: match[1] ? (/class|interface|struct|enum/.test(match[0]) ? "class" : "fn") : "assign",
    });
    DECLARATION.lastIndex = next > 0 ? next : DECLARATION.lastIndex;
  }
  return out;
}

/** Вызовы: имя, за которым сразу идёт «(». */
export function callsIn(code: string): Set<string> {
  const found = new Set<string>();
  for (const match of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1];
    if (name.length < 3 || TOO_COMMON.has(name)) continue;
    found.add(name);
  }
  return found;
}

/**
 * Собирает граф из списка кусков кода окна.
 *
 * Отдельно считается, где имя называется **вне** своего объявления: вызов в
 * своём же файле ничего не доказывает, агент мог проверять своё своё.
 */
export function buildGraph(chunks: { code: string; source: string }[]): Graph {
  const declared: Decl[] = [];
  const called = new Set<string>();
  const seen = new Set<string>();
  const outside = new Map<string, number>();
  for (const chunk of chunks) {
    const own = new Set(declarationsIn(chunk.code, chunk.source).map((d) => d.name));
    for (const decl of declarationsIn(chunk.code, chunk.source)) {
      if (seen.has(decl.name)) continue;
      seen.add(decl.name);
      declared.push(decl);
    }
    for (const name of callsIn(chunk.code)) {
      called.add(name);
      if (!own.has(name)) outside.set(name, (outside.get(name) ?? 0) + 1);
    }
  }
  return { declared, called, read: new Set(), outside };
}

/**
 * Велосипеды: объявлено в окне, до окна не было, и никто, кроме самого
 * объявления, к нему не обращается.
 *
 * Почему не «вызвано вообще»: замер на подтверждённом случае показал, что
 * `createAnthropicEffortProbe` вызывается в тесте, который агент написал в том
 * же окне. Такой вызов ничего не доказывает — агент проверяет своё своё же.
 * Значит вызов ищется ВНЕ куска, где имя объявлено.
 *
 * `before` — имена, объявленные в проекте ДО окна.
 * `calledOutside` — имя → куски, где оно вызывается вне своего объявления.
 */
export function bikes(g: Graph, before: Set<string>, calledOutside: Map<string, number>): Decl[] {
  return g.declared.filter((decl) => {
    if (before.has(decl.name)) return false;
    // Вызвано где-то ещё, не в своём объявлении, — рабочая вещь.
    if ((calledOutside.get(decl.name) ?? 0) > 0) return false;
    return true;
  });
}
