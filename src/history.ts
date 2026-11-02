/**
 * Когда файл появился в репозитории — ось времени детектора.
 *
 * Детектор сравнивает окно транскрипта с репозиторием СЕГОДНЯ. Если «готовое»
 * написано позже окна, велосипеда нет: агент был первым, а совпавшая функция —
 * его же код, переписанный позже или перенесённый в другое место.
 *
 * Замер 2026-11-02 без этой оси: 124 находки, 64 из них (52%) — файл готового
 * появился ПОСЛЕ окна. Две мнимые пары, которые она снимает:
 *   `_basis_date` → `basis_date`, сходство 0,915: `halava/agent.py` создан
 *   коммитом aa9187a в 18:39 MSK, окно писало `critic.py` в 13:32 MSK;
 *   `reasonText` → `exitText`, 0,704, файл готового добавлен после окна.
 *
 * Спрашиваем git у каталога самого файла, а не у корня прогона: готовое
 * бывает в worktree (`.claude/worktrees/<имя>/…`), и это другой чекаут с
 * другой ветвью — `git log` корня таких файлов не знает.
 */
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { existsSync } from "node:fs";

/** Путь ресурса из hit (`./carousel/x.py`) → абсолютный. */
export function absoluteOf(checkout: string, relPath: string): string {
  return `${checkout.replace(/\/+$/, "")}/${relPath.replace(/^\.\//, "")}`.split("\\").join("/");
}

/**
 * Дата добавления файла по git. `null` — файла нет в истории этого чекаута.
 *
 * Неизвестный файл — это не «был раньше», а «судить не по чему»: он может
 * быть несохранённой правкой окна (тогда велосипеда нет) или старым
 * игнорируемым файлом (тогда велосипед возможен). Детектор такие пары
 * помечает `unknown`, а не отбрасывает молча.
 */
export function addedAt(absolutePath: string): string | null {
  let dir = dirname(absolutePath);
  // Ближайший вверх каталог с `.git`: worktree и вложенный чекаут отвечают сами.
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(`${dir}/.git`)) break;
    const up = dirname(dir);
    if (up === dir || up === ".") return null;
    dir = up;
  }
  const name = absolutePath.slice(dir.length + 1);
  try {
    const out = execFileSync(
      "git",
      ["log", "-1", "--format=%cI", "--diff-filter=A", "--no-renames", "HEAD", "--", name],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** `true` — было на момент окна, `false` — появилось позже, `null` — неизвестно. */
export function existedAt(absolutePath: string, iso: string): boolean | null {
  const added = addedAt(absolutePath);
  if (added === null) return null;
  return added <= iso;
}
