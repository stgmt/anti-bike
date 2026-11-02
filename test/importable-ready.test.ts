/**
 * AB-22: отбор пар, где готовое можно было импортировать.
 *
 * Автор 2026-11-02 сузил задачу: нужен дешёвый и точный сигнал, то есть случаи,
 * где готовое лежало в именованном объявлении и реюзом было одно слово
 * `export`. Случаи, где надо выносить общее из тела функции, он отложил.
 *
 * Тест на приёмах трёх настоящих велосипедов из одной сессии (agts-merge,
 * 2026-11-02):
 *  1. `workSync` — готовое в `interface Dependencies`, копия в новом интерфейсе.
 *     Это цель: реюз стоил одного слова. Обязан пройти.
 *  2. `readActiveLaneIds` — готовое внутри тела функции. Обязан отсечься.
 *  3. `getCurrentOpenCodeRuntimeRunId` — готовое в объекте-аргументе вызова.
 *     Обязан отсечься.
 *
 * Направление пары задают даты добавления файлов в git, поэтому фикстура
 * собирает настоящий репозиторий, а не подсовывает числа.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { importableReady } from "../src/importable.ts";
import type { Clone } from "../src/importable.ts";

/** Репозиторий, где каждый файл добавлен своим коммитом на свою дату. */
async function repoWith(files: [string, string, string][]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ab-ready-"));
  const git = (iso: string, ...args: string[]): void => {
    execFileSync("git", args, {
      cwd: dir,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: iso,
        GIT_COMMITTER_DATE: iso,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
  };
  git("2026-01-01T00:00:00+03:00", "init", "-q");
  for (const [file, content, iso] of files) {
    const full = join(dir, file);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content, "utf8");
    git(iso, "add", "-A");
    git(iso, "commit", "-qm", `add ${file}`);
  }
  return dir;
}

/** Готовое: члены объявлены прямо в интерфейсе — реюз стоит слова export. */
const READY_DECL = `export interface Dependencies {
  profile: Readonly<Profile>;
  workSync: {
    buildHookSettings(input: { provider: 'claude' }): Promise<Record<string, unknown> | null>;
    buildEnvironment(input: { provider: 'codex' }): Promise<Record<string, string> | null>;
  };
}
`;

/** Копия: тот же блок переписан в новом интерфейсе более позднего файла. */
const COPY_DECL = `export interface ProductionSources {
  profile: Readonly<Profile>;
  workSync: {
    buildHookSettings(input: { provider: 'claude' }): Promise<Record<string, unknown> | null>;
    buildEnvironment(input: { provider: 'codex' }): Promise<Record<string, string> | null>;
  };
}
`;

/** Готовое: функция внутри тела фабрики — импортировать нечего. */
const READY_IN_BODY = `export function createWatcher(deps: Deps): Watcher {
  const readActiveLaneIds = async (teamName: string): Promise<string[] | null> => {
    const laneIndex = await readLaneIndex(deps.basePath, teamName).catch(() => null);
    if (!laneIndex) return null;
    return Object.values(laneIndex.lanes)
      .filter((lane) => lane.state === 'active')
      .map((lane) => lane.laneId);
  };
  return { readActiveLaneIds };
}
`;

/** Готовое: стрелка в объекте-аргументе вызова — тоже не импортируется. */
const READY_IN_CALL = `export function build(deps: Deps): Identity {
  return createIdentity({
    getCurrentRunId: (teamName: string, laneId: string) =>
      deps.runs.getRuns(teamName).find((entry) => entry.laneId === laneId)?.runId ?? null,
  });
}
`;

/**
 * Пара в форме отчёта jscpd. Имена файлов — от папки прогона (`src`), а не от
 * корня репозитория: так их пишет сам jscpd.
 */
function clone(first: string, second: string, fragment: string, lines: number, start = 1): Clone {
  return {
    lines,
    tokens: 0,
    fragment,
    firstFile: { name: first, start, end: start + lines },
    secondFile: { name: second, start, end: start + lines },
  };
}

describe("AB-22: отбор пар с импортируемым готовым", () => {
  let dir = "";
  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  });

  before(async () => {
    dir = await repoWith([
      ["src/ready.ts", READY_DECL, "2026-10-30T18:15:51+03:00"],
      ["src/copy.ts", COPY_DECL, "2026-11-02T16:52:26+03:00"],
      ["src/watchdog.ts", READY_IN_BODY, "2026-11-02T01:13:57+03:00"],
      ["src/stack.ts", `${COPY_DECL}\nexport const x = 1;\n`, "2026-11-02T20:46:13+03:00"],
      ["src/identity.ts", READY_IN_CALL, "2026-11-02T01:10:00+03:00"],
      ["src/delivery.ts", `${READY_IN_CALL}\nexport const y = 1;\n`, "2026-11-02T20:50:00+03:00"],
    ]);
  });

  it("AB-22: готовое в объявлении проходит, копия в новом объявлении — тоже", () => {
    const rows = importableReady(
      { duplicates: [clone("ready.ts", "copy.ts", COPY_DECL, 6, 1)] },
      dir,
      "src",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].importable, true);
    assert.equal(rows[0].ready, "src/ready.ts");
    assert.equal(rows[0].copy, "src/copy.ts");
  });

  it("AB-22: готовое внутри тела функции отсекается", () => {
    const rows = importableReady(
      { duplicates: [clone("watchdog.ts", "stack.ts", "const laneIndex = 1;\n", 4, 2)] },
      dir,
      "src",
    );
    assert.equal(rows[0].importable, false);
  });

  it("AB-22: готовое в объекте-аргументе вызова отсекается", () => {
    const rows = importableReady(
      { duplicates: [clone("identity.ts", "delivery.ts", "getCurrentRunId: (a, b) => null,\n", 2, 3)] },
      dir,
      "src",
    );
    assert.equal(rows[0].importable, false);
  });

  it("AB-22: файл вне git направления не имеет и в отбор не идёт", () => {
    // Строка `no-such.ts` в репозитории отсутствует: даты нет, пара пропускается.
    const rows = importableReady(
      { duplicates: [clone("no-such.ts", "copy.ts", COPY_DECL, 6, 1)] },
      dir,
      "src",
    );
    assert.equal(rows.length, 0);
  });
});
