/**
 * AB-20: ось времени — готовое должно было существовать на момент окна.
 *
 * Детектор сравнивает окно с репозиторием сегодня. Без этой проверки пара
 * находится там, где агент был первым: файл готового создан позже.
 * Замер 2026-11-02: 64 находки из 124 (52%) были такими.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { absoluteOf, addedAt, existedAt } from "../src/history.ts";

/** Репозиторий с одним коммитом на заданную дату. */
async function repoWith(file: string, iso: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ab-hist-"));
  const git = (...args: string[]): void => {
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
  git("init", "-q");
  await writeFile(join(dir, file), "export function f() { return 1; }\n", "utf8");
  git("add", "-A");
  git("commit", "-qm", "add");
  return dir;
}

describe("AB-20: ось времени", () => {
  it("AB-20: файл, добавленный до окна, считается готовым", async () => {
    const dir = await repoWith("ready.ts", "2026-07-07T00:00:00+03:00");
    try {
      assert.equal(existedAt(absoluteOf(dir, "./ready.ts"), "2026-10-21T00:01:30Z"), true);
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  });

  it("AB-20: файл, добавленный после окна, велосипедом не считается", async () => {
    // Настоящий случай: `halava/agent.py` создан 18:39 MSK, окно писало
    // `critic.py` в 13:32 MSK, и совпадение 0,915 оказалось кодом того же
    // агента, перенесённым позже.
    const dir = await repoWith("agent.py", "2026-10-25T18:39:58+03:00");
    try {
      assert.equal(existedAt(absoluteOf(dir, "./agent.py"), "2026-10-25T10:32:41Z"), false);
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  });

  it("AB-20: файл вне git — «неизвестно», а не «было раньше»", async () => {
    const dir = await repoWith("tracked.ts", "2026-07-07T00:00:00+03:00");
    try {
      await writeFile(join(dir, "untracked.ts"), "x\n", "utf8");
      assert.equal(addedAt(join(dir, "untracked.ts").split("\\").join("/")), null);
      assert.equal(existedAt(absoluteOf(dir, "./untracked.ts"), "2026-10-21T00:01:30Z"), null);
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  });

  it("AB-20: дата берётся у чекаута самого файла, а не у корня", async () => {
    // Готовое лежит в worktree — это другой чекаут. `git log` корня такого
    // файла не знает и вернул бы «неизвестно».
    const root = await repoWith("main.ts", "2026-07-07T00:00:00+03:00");
    try {
      execFileSync("git", ["worktree", "add", "-q", "-b", "wt", `${root}-wt`], { cwd: root, stdio: "ignore" });
      const wtFile = `${root}-wt/main.ts`;
      assert.equal(addedAt(wtFile.split("\\").join("/")), "2026-07-07T00:00:00+03:00");
      await rm(`${root}-wt`, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  });
});
