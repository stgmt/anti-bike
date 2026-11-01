/**
 * jscpd как источник фактов о клонах.
 *
 * jscpd 5.4.2 (Rust-движок поверх Node-обёртки) стартует ~2,8 с, скан `carousel/`
 * (98 файлов, 21 440 строк) идёт 96–2900 мс. Свой детектор не пишем: берём готовый.
 *
 * Соответствие флагов снято `jscpd --help` на 5.4.2, а не по памяти:
 *   --changed            только файлы, которые git назвал изменёнными
 *   --baseline-from-ref  сравнение с базовой ревизией, а не с прошлым прогоном
 *   --fail-on-new-clones код выхода 1 при новых клонах
 *   --kind renamed       требует --ignore-identifiers
 *   --kind gap           требует --max-gap-lines
 *   --reporters json + --output <каталог>, в stdout отчёт не идёт
 *
 * Форма ответа снята живым прогоном 2026-11-01 и лежит в `test/fixtures/`:
 * верхний уровень `{duplicates, statistics}`, у клона `firstFile`/`secondFile`
 * с `name`/`start`/`end`, количество `lines`, `tokens`, `kind` и флаг `isNew`.
 */

export type CloneKind = "exact" | "renamed" | "similar" | "gap" | "ast" | "semantic";

/** Флаг jscpd --kind, который включает этот вид клона. */
const KIND_BY_CLONE: Record<CloneKind, CloneKind> = {
  exact: "exact",
  renamed: "renamed",
  similar: "similar",
  gap: "gap",
  ast: "ast",
  semantic: "semantic",
};

export interface CloneSide {
  /** Путь от корня репозитория, как его назвал jscpd (через `\` на Windows). */
  path: string;
  /** С какой строки начинается совпадение. */
  start: number;
  /** Последняя строка совпадения. */
  end: number;
  /** Сколько строк занимает совпадение, по счёту jscpd. */
  lines: number;
}

export interface Clone {
  /** Сторона, которая уже лежала до хода. */
  existing: CloneSide;
  /** Сторона, которая появилась или изменилась в этом ходе. */
  fresh: CloneSide;
  tokens: number;
  kind: CloneKind;
  /** jscpd сам говорит, чего не было в базовой ревизии. */
  isNew: boolean;
  /** Первые строки совпадения: нужны, чтобы показать адрес человеку. */
  fragment: string;
}

export interface ScanOptions {
  /** Путь для скана, обычно корень репозитория. */
  root: string;
  /** Базовая ревизия. Клон новый, если его нет в ней. */
  baseRef?: string;
  minLines?: number;
  minTokens?: number;
  kinds?: CloneKind[];
  /** Обязателен для `gap`: сколько строк разрыва ещё считается совпадением. */
  maxGapLines?: number;
  /** Игнорировать имена: включает `--kind renamed`. */
  ignoreIdentifiers?: boolean;
  /** Куда jscpd положит `jscpd-report.json`. */
  outputDir?: string;
}

const DEFAULTS = {
  minLines: 8,
  minTokens: 50,
  kinds: ["exact", "gap", "renamed"] as CloneKind[],
  maxGapLines: 5,
} as const;

/**
 * Команда для jscpd. Вынесена отдельно: тесты проверяют её без запуска процесса,
 * а хук получает одну точку, где меняется набор флагов.
 */
export function buildArgs(options: ScanOptions): string[] {
  const kinds = (options.kinds ?? DEFAULTS.kinds).map((kind) => KIND_BY_CLONE[kind]);
  const args = [
    options.root,
    "--changed",
    "--baseline-from-ref",
    options.baseRef ?? "HEAD",
    "--fail-on-new-clones",
    "--kind",
    kinds.join(","),
    "--min-lines",
    String(options.minLines ?? DEFAULTS.minLines),
    "--min-tokens",
    String(options.minTokens ?? DEFAULTS.minTokens),
    "--reporters",
    "json",
    "--output",
    options.outputDir ?? ".jscpd",
    "--silent",
  ];
  // Без этого флага `--kind renamed` предупреждает и не даёт клонов.
  if (kinds.includes("renamed") || options.ignoreIdentifiers) {
    args.push("--ignore-identifiers");
  }
  // Без этого флага `--kind gap` предупреждает и не даёт клонов.
  if (kinds.includes("gap")) {
    args.push("--max-gap-lines", String(options.maxGapLines ?? DEFAULTS.maxGapLines));
  }
  return args;
}

interface RawSide {
  name?: unknown;
  start?: unknown;
  end?: unknown;
}

interface RawClone {
  firstFile?: RawSide;
  secondFile?: RawSide;
  tokens?: unknown;
  lines?: unknown;
  kind?: unknown;
  isNew?: unknown;
  fragment?: unknown;
}

/**
 * Разбор отчёта jscpd. Пустой ввод — нет клонов, это не ошибка.
 * Битый JSON — ошибка с началом ввода: молча вернуть «чисто» нельзя.
 */
export function parseReport(raw: string): Clone[] {
  const trimmed = raw.trim();
  if (trimmed === "") return [];

  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    throw new Error(`jscpd вернул не JSON: ${trimmed.slice(0, 200)}`);
  }

  if (typeof payload !== "object" || payload === null) {
    throw new Error("jscpd вернул не объект");
  }
  const duplicates = (payload as { duplicates?: unknown }).duplicates;
  if (!Array.isArray(duplicates)) {
    throw new Error("в ответе jscpd нет duplicates");
  }
  return duplicates.map((row) => toClone(row as RawClone));
}

function toClone(row: RawClone): Clone {
  return {
    existing: toSide(row.secondFile),
    fresh: toSide(row.firstFile),
    tokens: Number(row.tokens ?? 0),
    kind: String(row.kind ?? "exact") as CloneKind,
    isNew: row.isNew === true,
    fragment: String(row.fragment ?? ""),
  };
}

function toSide(raw: RawSide | undefined): CloneSide {
  const start = Number(raw?.start ?? 0);
  const end = Number(raw?.end ?? 0);
  return {
    path: String(raw?.name ?? "").replaceAll("\\", "/"),
    start,
    end,
    lines: Math.max(0, end - start + 1),
  };
}

/** Клоны, которых не было в базовой ревизии. Только они и считаются находкой хода. */
export function onlyNew(clones: Clone[]): Clone[] {
  return clones.filter((clone) => clone.isNew);
}

/** Адрес для сообщения агенту: `путь:строка` с обеих сторон. */
export function address(clone: Clone): string {
  return `${clone.fresh.path}:${clone.fresh.start} уже есть в ${clone.existing.path}:${clone.existing.start}`;
}
