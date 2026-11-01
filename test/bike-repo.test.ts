/**
 * Сквозная проверка на настоящей фикстуре: агент написал `agent_wrote.py`,
 * который повторяет `existing.py`. Гейт обязан найти новый клон и указать адрес.
 *
 * Проверяются три вещи, каждая ловит свою поломку:
 *  1. клон находится — иначе гейт молчит на настоящем велосипеде;
 *  2. `isNew` верный — иначе старый дубль в репо блокирует каждый ход;
 *  3. `legit.py` не тронут — иначе гейт запрещает любую новую работу.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { address } from "../src/clones.ts";
import { scan } from "../src/scan.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "bike-repo", "src");

const EXISTING = await readFile(join(FIXTURE, "existing.py"), "utf8");
const LEGIT = await readFile(join(FIXTURE, "legit.py"), "utf8");
const AGENT_WROTE = await readFile(join(FIXTURE, "agent_wrote.py"), "utf8");

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Репо, где база — только existing.py и legit.py, а agent_wrote.py появился в ходе. */
async function repoWithAgentTurn(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "anti-bike-"));
  const src = join(root, "src");
  await mkdir(src, { recursive: true });
  await writeFile(join(src, "existing.py"), EXISTING);
  await writeFile(join(src, "legit.py"), LEGIT);
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "test");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  await writeFile(join(src, "agent_wrote.py"), AGENT_WROTE);
  return root;
}

describe("настоящая фикстура: велосипед в коде", () => {
  it("находит новый клон и называет обе стороны", async () => {
    const root = await repoWithAgentTurn();
    try {
      const result = await scan({ root, baseRef: "HEAD", outputDir: join(root, ".jscpd") });
      const fresh = result.clones.filter((clone) => clone.isNew);
      assert.ok(fresh.length >= 1, "новый велосипед не найден");
      for (const clone of fresh) {
        assert.equal(clone.fresh.path, "src/agent_wrote.py");
        assert.equal(clone.existing.path, "src/existing.py");
        assert.match(address(clone), /agent_wrote\.py:\d+ уже есть в src\/existing\.py:\d+/);
      }
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  });

  it("законную новую работу не трогает", async () => {
    const root = await repoWithAgentTurn();
    try {
      const result = await scan({ root, baseRef: "HEAD", outputDir: join(root, ".jscpd") });
      const onLegit = result.clones.filter((clone) => clone.fresh.path.includes("legit"));
      assert.deepEqual(onLegit, [], "гейт запретил новую работу, у которой нет аналога");
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  });

  it("дубль, лежавший до хода, новым не считается", async () => {
    const root = await repoWithAgentTurn();
    try {
      // Второй ход ничего не пишет: тот же скан не должен дать новых клонов.
      git(root, "add", "-A");
      git(root, "commit", "-qm", "agent turn landed");
      const result = await scan({ root, baseRef: "HEAD", outputDir: join(root, ".jscpd") });
      assert.deepEqual(result.clones.filter((clone) => clone.isNew), []);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  });
});

describe("границы", () => {
  it("пустой ход не тратит скан: jscpd не зовётся, когда файлов не меняли", async () => {
    const root = await mkdtemp(join(tmpdir(), "anti-bike-empty-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "a.py"), "print('hello')\n");
      git(root, "init", "-q");
      git(root, "config", "user.email", "test@example.com");
      git(root, "config", "user.name", "test");
      git(root, "add", "-A");
      git(root, "commit", "-qm", "base");
      const result = await scan({ root, baseRef: "HEAD", outputDir: join(root, ".jscpd") });
      assert.deepEqual(result.clones, []);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  });
});

// Фикстура едет в репо целиком: без неё тест не воспроизводится на другой машине.
describe("фикстура на месте", () => {
  it("три файла, из них ровно один — велосипед", async () => {
    const files = await Promise.all(
      ["existing.py", "agent_wrote.py", "legit.py"].map((name) => readFile(join(FIXTURE, name), "utf8")),
    );
    assert.equal(files.length, 3);
    assert.ok(!files[2].includes("ResponseCache"), "законная работа не должна копировать кэш");
  });
});
