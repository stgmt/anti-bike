/**
 * AB-23: велосипед в коммите, без поданного извне списка пар.
 *
 * Автор 2026-11-03: «нужны только тесты на фикстуре которая комит. коммит
 * контекст это диф и весь репо целиком. иначе ты подтасовываешь».
 *
 * Поэтому фикстура — настоящий git-репозиторий, где первый коммит кладёт
 * готовое, а второй повторяет его. Детектор получает только путь и коммит:
 * что такое «добавлено» он берёт из дифа, что такое «готово» — из дерева
 * родителя. Никаких ожидаемых пар снаружи не передаётся.
 *
 * Случаи взяты с настоящих велосипедов одной сессии (agts-merge, 2026-11-02).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { copiesInCommit, regionsIn } from "../src/commit.ts";

/** Репозиторий из последовательности коммитов: [файл, текст][] на коммит. */
async function commits(steps: [string, string][][]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ab-commit-"));
  const git = (...args: string[]): void => {
    execFileSync("git", args, {
      cwd: dir,
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
  };
  git("init", "-q");
  for (const [n, step] of steps.entries()) {
    for (const [file, text] of step) {
      const full = join(dir, file);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, text, "utf8");
    }
    git("add", "-A");
    git("commit", "-qm", `step ${n + 1}`);
  }
  return dir;
}

/** Готовое: блок живёт в `interface Dependencies`. */
const PORTS = `export interface Dependencies {
  profile: string;
  attachmentRoot: string;
  workSync: {
    buildHookSettings(input: { provider: string }): Promise<Record<string, unknown> | null>;
    buildEnvironment(input: { provider: string }): Promise<Record<string, string> | null>;
  };
}
`;

/** Посторонняя работа в том же репозитории: не должна попадать в находки. */
const OTHER = `export interface Other {
  readConfig(name: string): Promise<string | null>;
  writeConfig(name: string, value: string): Promise<void>;
  flushPendingWrites(): Promise<number>;
}
`;

/** Тот же блок, но вокруг другие поля: скопирован ровно вложенный кусок. */
const SUPPORT = `export interface ProductionSources {
  logger: string;
  runs: string;
  workSync: {
    buildHookSettings(input: { provider: string }): Promise<Record<string, unknown> | null>;
    buildEnvironment(input: { provider: string }): Promise<Record<string, string> | null>;
  };
}
`;

/** Своя работа, которой в родителе нет: находкой быть не должна. */
const FRESH = `export interface DeliveryHost {
  messageAdapter(): Adapter | null;
  stoppingTeams: { has(teamName: string): boolean };
  isMemberLifecycleOperationActive(teamName: string, memberName: string): boolean;
  readPersistedTeamProjectPath(teamName: string): string | null;
}
`;

describe("AB-23: копия внутри коммита", () => {
  const made: string[] = [];
  after(async () => {
    for (const dir of made) {
      await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  });

  it("AB-23: копия блока в новом интерфейсе находится в родителе", async () => {
    const dir = await commits([
      [["src/ports.ts", PORTS], ["src/other.ts", OTHER]],
      [["src/support.ts", SUPPORT]],
    ]);
    made.push(dir);

    const copies = copiesInCommit(dir, "HEAD");

    assert.equal(copies.length, 1);
    assert.equal(copies[0]!.added.file, "src/support.ts");
    assert.equal(copies[0]!.added.name, "workSync");
    assert.equal(copies[0]!.ready.file, "src/ports.ts");
    assert.equal(copies[0]!.ready.name, "workSync");
  });

  it("AB-23: своя работа без готового не попадает в находки", async () => {
    const dir = await commits([
      [["src/ports.ts", PORTS]],
      [["src/fresh.ts", FRESH]],
    ]);
    made.push(dir);

    // Четыре сигнатуры подряд — достаточно длинное тело, но такой работы в
    // родителе нет.
    assert.deepEqual(copiesInCommit(dir, "HEAD"), []);
  });

  it("AB-23: готовое, добавленное в том же коммите, велосипедом не считается", async () => {
    // Оба файла в одном коммите: агент написал их вместе, «готового раньше» нет.
    // Первый коммит несёт только посторонний файл, чтобы родитель существовал:
    // без родителя сравнивать не с чем, и тест прошёл бы по неверной причине.
    const dir = await commits([
      [["src/a.ts", OTHER]],
      [["src/ports.ts", PORTS], ["src/support.ts", SUPPORT]],
    ]);
    made.push(dir);

    assert.deepEqual(copiesInCommit(dir, "HEAD"), []);

    // Тот же блок, добавленный третьим коммитом, уже находка: готовое к этому
    // времени лежит в родителе.
    await writeFile(join(dir, "src/later.ts"), SUPPORT, "utf8");
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore", windowsHide: true });
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "later"],
      { cwd: dir, stdio: "ignore", windowsHide: true },
    );
    assert.ok(copiesInCommit(dir, "HEAD").length >= 1);
  });

  it("AB-23: без явного коммита берётся HEAD", async () => {
    const dir = await commits([
      [["src/ports.ts", PORTS]],
      [["src/support.ts", SUPPORT]],
    ]);
    made.push(dir);

    // Вызываем без второго аргумента: путь по умолчанию — HEAD.
    assert.equal(copiesInCommit(dir).length, 1);
  });

  it("AB-23: корневой коммит сравнивать не с чем и находок не даёт", async () => {
    const dir = await commits([[["src/ports.ts", PORTS], ["src/support.ts", SUPPORT]]]);
    made.push(dir);

    assert.deepEqual(copiesInCommit(dir, "HEAD"), []);
  });

  it("AB-23: правка без копий ничего не находит", async () => {
    const dir = await commits([
      [["src/ports.ts", PORTS]],
      [["src/other.ts", OTHER]],
    ]);
    made.push(dir);
    // HEAD добавил OTHER; PORTS лежит в родителе, но OTHER на него не похож.
    assert.deepEqual(copiesInCommit(dir, "HEAD"), []);
  });

  it("AB-23: копия внутри тела функции по умолчанию не находка", async () => {
    // Готовое — стрелка внутри тела фабрики.
    const ready = `export function createWatcher(deps: Deps): Watcher {
  const readActiveLaneIds = async (teamName: string): Promise<string[] | null> => {
    const laneIndex = await readLaneIndex(deps.basePath, teamName).catch(() => null);
    if (!laneIndex) return null;
    return Object.values(laneIndex.lanes)
      .filter((lane) => lane.state === "active")
      .map((lane) => lane.laneId);
  };
  return { readActiveLaneIds };
}
`;
    const copy = `export function createStack(sources: Sources): Stack {
  return build({
    readActiveRuntimeLaneIds: async (teamName: string) => {
      const laneIndex = await readLaneIndex(sources.basePath, teamName).catch(() => null);
      if (!laneIndex) return null;
      return Object.values(laneIndex.lanes)
        .filter((lane) => lane.state === "active")
        .map((lane) => lane.laneId);
    },
  });
}
`;
    const dir = await commits([
      [["src/watchdog.ts", ready]],
      [["src/stack.ts", copy]],
    ]);
    made.push(dir);

    assert.deepEqual(copiesInCommit(dir, "HEAD"), []);
    // С флагом — видна: работа одна, но реюз требует выноса, а не импорта.
    assert.ok(copiesInCommit(dir, "HEAD", { includeInFunction: true }).length >= 1);
  });
});

describe("AB-23: разбор кусков", () => {
  it("AB-23: вложенный член интерфейса имеет свой кусок и знает предка", () => {
    const regions = regionsIn(PORTS, "ports.ts");
    const inner = regions.find((r) => r.name === "workSync");
    assert.ok(inner, "вложенный блок не найден");
    assert.equal(inner.kind, "member");
    assert.equal(inner.enclosing, "Dependencies");
    // Тело вложенного меньше тела интерфейса: иначе сравнивался бы весь файл.
    const outer = regions.find((r) => r.name === "Dependencies");
    assert.ok(outer);
    assert.ok(inner.body.length < outer.body.length);
  });

  it("AB-23: скобки внутри строк и комментариев не ломают границы куска", () => {
    const text = `export interface A {
  // тут } и { в комментарии
  value: string; // и тут }
  template: \`}{ между ними \`;
}
export interface B {
  other: number;
}
`;
    const a = regionsIn(text, "x.ts").find((r) => r.name === "A");
    assert.ok(a);
    assert.equal(a.end, 5);
  });
});
