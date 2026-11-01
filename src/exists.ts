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

/** Шаблон объявления: class/def или присваивание. Подстрока не годится. */
export function declarationArgs(names: string[], roots: string[]): string[] {
  const patterns: string[] = [];
  for (const name of names) {
    patterns.push("-e", `class ${name}`, "-e", `def ${name}`, "-e", `^${name} = `, "-e", `^${name}: `);
  }
  return ["-n", "-H", "-F", ...patterns, "--type", "py", ...roots];
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
    if (line.trim() === "") continue;
    const match = /^(.*?):(\d+):(.*)$/.exec(line);
    if (!match) continue;
    const [, where, number, body] = match;
    for (const name of names) {
      if (found.has(name)) continue;
      const head = body.trimStart();
      const kind = head.startsWith(`class ${name}`)
        ? "class"
        : head.startsWith(`def ${name}`) || head.startsWith(`async def ${name}`)
          ? "def"
          : head.startsWith(`${name} =`) || head.startsWith(`${name}:`)
            ? "assign"
            : "";
      if (kind === "") continue;
      found.set(name, { name, where, kind, line: Number(number) });
    }
  }
  return [...found.values()];
}

/** Ищет объявления названных сущностей в пакете проекта. */
export async function findDeclarations(
  names: string[],
  options: ExistsOptions,
): Promise<Found[]> {
  if (names.length === 0 || options.roots.length === 0) return [];
  const args = declarationArgs(names, options.roots);
  try {
    const { stdout } = await run("rg", args, {
      timeout: options.timeoutMs ?? 5_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseFound(stdout, names);
  } catch (error) {
    // ripgrep с кодом 1 — «не найдено», это не сбой.
    const stdout = (error as { stdout?: string }).stdout ?? "";
    if (stdout.trim() !== "") return parseFound(stdout, names);
    if ((error as { code?: number }).code === 1) return [];
    throw error;
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
