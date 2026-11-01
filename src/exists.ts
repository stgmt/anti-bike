/**
 * Проверка существования: есть ли названная сущность в коде проекта.
 *
 * Автор 2026-11-01: «я рассчитывал что уже передается аст тул для просмотра
 * кода для этого за миллисекунды».
 *
 * Замерено на carousel-demo, шесть имён:
 *   обход всего репозитория в памяти  86 657 мс, 3 ошибки из 6;
 *   ripgrep по пакету carousel/           342 мс, 6 из 6 верно;
 *   ripgrep по объявлениям                345 мс, 6 из 6 верно;
 *   Python AST по пакету                  906 мс, 6 из 6 верно.
 *
 * Почему обход всего репозитория ошибался: в него входят `.venv-bdd` (чужой
 * пакет дал StepContext) и мои же скрипты-пробы (RunContext из пробы). Пакет
 * проекта отсекает оба случая. Поэтому поиск идёт только по пакету.
 *
 * Разбор AST дороже вдвое и здесь не нужен: имена из сводки — идентификаторы,
 * а не выражения, и объявление у них начинается со слова class, def или с
 * присваивания. AST держим на случай, когда понадобится связывать имя с телом.
 */

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Found {
  /** Названная сущность. */
  name: string;
  /** Где объявлена: путь от корня пакета. Пусто, если нигде. */
  where: string;
  /** Как объявлена: class, def, assign. */
  kind: string;
  /** Строка объявления. */
  line: number;
}

export interface ExistsOptions {
  /** Каталоги пакета, например ["carousel"]. Пробы и прогоны сюда не входят. */
  roots: string[];
  /** Потолок времени на все имена сразу. */
  timeoutMs?: number;
}

/**
 * Где объявления и как они выглядят — по языкам.
 *
 * `--type py` был дефектом: в репозитории на TypeScript проверка не находила
 * ничего, и любое названное имя считалось отсутствующим. Это переворачивает
 * вердикт в опасную сторону — работа выглядит велосипедом.
 * Замер: имя `TeamProvisioningProviderPreflight`, лежащее в репо,
 * по `--type py` давало 0 находок.
 */
const LANGUAGES: { glob: string; globs: string[]; classLike: RegExp; fnLike: RegExp }[] = [
  {
    glob: "py",
    globs: ["-g", "*.py"],
    classLike: /^(?:class|interface|type|enum)\s/,
    fnLike: /^(?:def|async def|function\*?)\s/,
  },
  {
    glob: "ts",
    globs: ["-g", "*.ts", "-g", "*.tsx", "-g", "*.js", "-g", "*.mjs", "-g", "*.cjs"],
    classLike: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:class|interface|type|enum)\s/,
    fnLike: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s/,
  },
];

/** Шаблон объявления: class/def/function или присваивание. Подстрока не годится. */
export function declarationArgs(names: string[], roots: string[]): string[] {
  const patterns: string[] = [];
  for (const name of names) {
    patterns.push(
      "-e", `class ${name}`,
      "-e", `interface ${name}`,
      "-e", `type ${name}`,
      "-e", `enum ${name}`,
      "-e", `def ${name}`,
      "-e", `function ${name}`,
      "-e", `const ${name}`,
      "-e", `let ${name}`,
      "-e", `var ${name}`,
      "-e", `^${name} = `,
      "-e", `^${name}: `,
    );
  }
  const globs = LANGUAGES.flatMap((language) => language.globs);
  return [
    "-n", "-H", "-F", ...patterns,
    ...globs,
    "-g", "!node_modules", "-g", "!.venv", "-g", "!venv", "-g", "!dist",
    ...roots,
  ];
}

/**
 * Разбирает ответ ripgrep в находки.
 *
 * Формат строки: путь:строка:текст. Двоеточие в пути на Windows — диск, поэтому
 * делим по первому двоеточию после «:число:».
 */
export function parseFound(raw: string, names: string[]): Found[] {
  const found = new Map<string, Found>();
  for (const line of raw.split("\n")) {
    // ripgrep на Windows заканчивает строку \r\n; без снятия \r шаблон
    // «путь:строка:текст» не совпадает, и теряется всё, кроме последней строки.
    const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (clean.trim() === "") continue;
    const match = /^(.*?):(\d+):(.*)$/.exec(clean);
    if (!match) continue;
    const [, where, number, body] = match;
    const head = body.trimStart();
    const kind = declaredKind(head, names);
    if (kind === "") continue;
    const name = nameIn(head) ?? "";
    if (name === "" || found.has(name)) continue;
    found.set(name, { name, where, kind, line: Number(number) });
  }
  return [...found.values()];
}

/**
 * Как объявлено имя в строке: class, fn, assign или ничего.
 *
 * Имена дают готовый набор, а не одно: строка объявления принадлежит одному
 * имени из набора, и лишнюю работу делает разбор, а не поиск. Модификаторы
 * (`export`, `default`, `abstract`, `async`) стоят перед словом объявления,
 * без их пропуска имена из .ts не находились.
 */
export function declaredKind(head: string, names: string | string[]): string {
  const list = typeof names === "string" ? [names] : names;
  for (const name of list) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Объявление стоит в начале строки, возможно с отступом и модификаторами.
    // `value = class Alpha` — присваивание класса, а не объявление Alpha.
    if (new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?(?:class|interface|type|enum|struct|trait)\\s+${escaped}\\b`).test(head)) return "class";
    if (new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:def|function)\\s*\\*?\\s*${escaped}\\b`).test(head)) return "fn";
    if (new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\b`).test(head)
      || new RegExp(`^${escaped}\\s*[:=]`).test(head)) return "assign";
  }
  return "";
}

/** Имя, объявленное в строке. Пусто, если строка не объявление. */
export function nameIn(head: string): string | null {
  const match = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|interface|type|enum|struct|trait|def|function|const|let|var)\s+\*?\s*([A-Za-z_$][\w$]*)/.exec(head);
  if (match) return match[1];
  const assign = /^\s*([A-Za-z_$][\w$]*)\s*[:=]/.exec(head);
  return assign ? assign[1] : null;
}

export interface FoundResult {
  found: Found[];
  /** Корни, которых нет на диске: проверка не состоялась, это не «нет». */
  missingRoots: string[];
}

/**
 * Ищет объявления названных сущностей в пакете проекта.
 *
 * Несуществующий корень — это «проверка не состоялась», а не «ничего нет».
 * Замер: в токен-плане прогон запустился с корнем `src/`, а в той копии
 * репозитория его нет; ripgrep падал, и окно уходило в «ошибку», хотя
 * вердикт должен был остаться прежним.
 */
export async function findDeclarations(
  names: string[],
  options: ExistsOptions,
): Promise<FoundResult> {
  if (names.length === 0 || options.roots.length === 0) return { found: [], missingRoots: [] };
  const present: string[] = [];
  const missingRoots: string[] = [];
  for (const root of options.roots) {
    if (await isDirectory(root)) present.push(root);
    else missingRoots.push(root);
  }
  if (present.length === 0) return { found: [], missingRoots };

  const args = declarationArgs(names, present);
  try {
    const { stdout } = await run("rg", args, {
      timeout: options.timeoutMs ?? 5_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { found: parseFound(stdout, names), missingRoots };
  } catch (error) {
    // ripgrep с кодом 1 — «не найдено», это не сбой.
    const stdout = (error as { stdout?: string }).stdout ?? "";
    if (stdout.trim() !== "") return { found: parseFound(stdout, names), missingRoots };
    if ((error as { code?: number }).code === 1) return { found: [], missingRoots };
    throw error;
  }
}

/** Каталог ли это: проверка существования не должна падать на пустом корне. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Делит находки на «уже есть в пакете» и «нет».
 *
 * Велосипед — то, чего в пакете нет. Если названное уже объявлено, агент писал
 * рабочую вещь, а не дублировал готовое.
 */
export function splitByExistence(
  names: string[],
  found: Found[],
): { exists: Found[]; absent: string[] } {
  const seen = new Set(found.map((item) => item.name));
  return {
    exists: found,
    absent: names.filter((name) => !seen.has(name)),
  };
}
