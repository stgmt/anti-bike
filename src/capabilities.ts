/**
 * Список возможностей проекта: что в нём уже умеет делать библиотека и сам код.
 *
 * Замеры 2026-11-01, один ход `[20252]`, Drex-Max, порог 0,5:
 *
 *   без списка                                        0,049  промах
 *   автосписок: модули пакета                         0,108  промах
 *   автосписок: имена импортов                        0,030  промах
 *   автосписок: docstring'и пакетов, 22 штуки         0,022  промах
 *   курируемый список возможностей, 720 символов      0,951  верно
 *
 * Корень: модель сравнивает **понятия**. В пакетах есть класс `StateGraph`, но
 * `context_schema` — его параметр, отдельного имени у него нет. Автосборка по
 * импортам и docstring'ам такое понятие не достаёт, а курируемая запись —
 * «StateGraph принимает state_schema и context_schema» — достаёт.
 *
 * Поэтому основной источник — файл `.anti-bike/capabilities.md` в репозитории:
 * его пишет человек или агент один раз на проект. Автосписок остаётся запасным.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Где лежит курируемый список возможностей. */
export const CAPABILITIES_PATH = join(".anti-bike", "capabilities.md");

/** Сколько символов списка терпит модель: длинный размывает ответ. */
export const MAX_CAPABILITIES = 3000;

export interface Capabilities {
  /** Текст для модели. */
  markdown: string;
  /** Откуда взят: `file` — курируемый, `auto` — собран из пакетов, `none` — пусто. */
  source: "file" | "auto" | "none";
  size: number;
}

/**
 * Читает курируемый список, если он есть.
 *
 * Размер ограничен: список на 10 тысяч символов модель не читает как список
 * возможностей, а тонет в нём.
 */
export async function readCapabilities(repoRoot: string): Promise<string | null> {
  try {
    const text = await readFile(join(repoRoot, CAPABILITIES_PATH), "utf8");
    const trimmed = text.trim();
    if (trimmed === "") return null;
    return trimmed.slice(0, MAX_CAPABILITIES);
  } catch {
    return null;
  }
}

/**
 * Собирает список возможностей: курируемый, если он есть, иначе запасной.
 *
 * Запасной путь — автосписок из импортов и docstring'ов. Он слабее (замеры выше),
 * но лучше пустоты: без списка вопрос «повторяет ли готовое» не имеет предмета.
 */
export async function resolveCapabilities(
  repoRoot: string,
  fallback: () => Promise<string>,
): Promise<Capabilities> {
  const curated = await readCapabilities(repoRoot);
  if (curated !== null) {
    return { markdown: curated, source: "file", size: curated.length };
  }
  const generated = await fallback();
  if (generated.trim() === "") {
    return { markdown: "", source: "none", size: 0 };
  }
  return { markdown: generated, source: "auto", size: generated.length };
}
