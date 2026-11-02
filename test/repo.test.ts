/**
 * AB-21: поиск велосипедов внутри репозитория, без транскриптов.
 *
 * Прогон по истории сессий видит только код, написанный после начала записи.
 * Велосипед, написанный раньше, ему не виден. Такой есть в agent-teams-ai:
 * `renameWithRetrySync` в `agent-teams-controller/src/internal/atomicFile.js`
 * повторяет готовый `renameWithRetrySync` из `src/main/utils/atomicWrite.ts`.
 *
 * Тест на приёмах того случая: одно имя, разные файлы, поздний повторяет
 * ранний, форма ниже порога шума — велосипед не должен отсекаться формой.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { scanRepo } from "../scripts/scan-repo.ts";

/** Репозиторий с файлами, каждый добавлен своим коммитом на свою дату. */
async function repoWith(files: [string, string, string][]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ab-repo-"));
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

const READY = `export function renameWithRetrySync(src: string, dest: string): void {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      fs.renameSync(src, dest);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (isTransientFsErrorCode(code) && attempt < MAX_ATTEMPTS) {
        sleepSync(retryDelayMs(attempt));
        continue;
      }
      throw error;
    }
  }
}
`;

/** Копия с добавленной веткой: форма разошлась, имя то же. */
const COPY = `function renameWithRetrySync(tempPath, filePath) {
  for (let attempt = 1; attempt <= RENAME_MAX_ATTEMPTS; attempt += 1) {
    try {
      fs.renameSync(tempPath, filePath);
      return;
    } catch (error) {
      if (error && error.code === 'EXDEV') {
        fs.copyFileSync(tempPath, filePath);
        try { fs.rmSync(tempPath, { force: true }); } catch { /* best effort */ }
        return;
      }
      if (error && RETRYABLE_RENAME_CODES.has(error.code) && attempt < RENAME_MAX_ATTEMPTS) {
        sleepSync(getRenameRetryDelayMs(attempt));
        continue;
      }
      throw error;
    }
  }
}
`;

/**
 * Наполнитель корпуса.
 *
 * Вес токена — log(всего / документов с ним). На корпусе из двух функций он
 * равен log(1) = 0, и форма любой пары выходит нулевой: так устроен IDF, а не
 * ошибка. В настоящем репозитории функций тысячи, и вес живой. Наполнитель
 * держит прогон честным, не подкручивая счёт.
 */
function filler(n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(`export function helper${i}(value: string): string {
  const parts = value.split("/");
  const last = parts[parts.length - 1] ?? "";
  if (last.length === 0) return value;
  return last.toUpperCase();
}
`);
  }
  return out.join("\n");
}

describe("AB-21: велосипед внутри репозитория", () => {
  it("AB-21: копия, появившаяся позже готового, попадает в пары", async () => {
    const dir = await repoWith([
      ["src/main/utils/atomicWrite.ts", READY, "2026-03-01T00:00:00+03:00"],
      ["agent-teams-controller/src/internal/atomicFile.js", COPY, "2026-05-15T00:00:00+03:00"],
      ["src/main/utils/text.ts", filler(60), "2026-01-15T00:00:00+03:00"],
    ]);
    try {
      const { rows } = scanRepo(dir, () => {});
      const pair = rows.find((r) => r.ownFile.includes("atomicFile.js") && r.own === "renameWithRetrySync");
      assert.ok(pair, `пара не найдена, всего пар: ${rows.length}`);
      assert.equal(pair.ready, "renameWithRetrySync");
      assert.equal(pair.readyFile, "src/main/utils/atomicWrite.ts");
      assert.equal(pair.sameName, true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("AB-21: готовое, появившееся позже, велосипедом не считается", async () => {
    const dir = await repoWith([
      ["agent-teams-controller/src/internal/atomicFile.js", COPY, "2026-03-01T00:00:00+03:00"],
      ["src/main/utils/atomicWrite.ts", READY, "2026-05-15T00:00:00+03:00"],
    ]);
    try {
      const { rows } = scanRepo(dir, () => {});
      assert.equal(
        rows.filter((r) => r.ownFile.includes("atomicFile.js")).length,
        0,
        "файл, написанный первым, назван копией",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("AB-21: две разные работы с похожим строением не склеиваются по имени", async () => {
    const other = `export function renameWithRetrySync(src: string, dest: string): void {
  writeAuditLine("rename", src, dest);
  metrics.increment("rename.attempt");
  notifySubscribers({ kind: "moved", from: src, to: dest });
  cache.invalidate(src);
  cache.invalidate(dest);
  scheduleCleanup(dest);
}
`;
    const dir = await repoWith([
      ["src/main/utils/atomicWrite.ts", READY, "2026-03-01T00:00:00+03:00"],
      ["src/main/audit/renameLog.ts", other, "2026-05-15T00:00:00+03:00"],
    ]);
    try {
      const { rows } = scanRepo(dir, () => {});
      const pair = rows.find((r) => r.ownFile.includes("renameLog.ts"));
      assert.equal(pair, undefined, "разная работа попала в пары по одному имени");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
