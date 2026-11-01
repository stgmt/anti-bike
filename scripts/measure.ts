/**
 * Замеры, которые решают судьбу хука: сколько стоит каждый слой.
 *
 * Запуск: node --experimental-strip-types scripts/measure.ts <путь-репо>
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scan } from "../src/scan.ts";

function time<T>(label: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  return work().then((value) => {
    console.log(`  ${label}: ${Math.round(performance.now() - started)} мс`);
    return value;
  });
}

function shell(command: string, cwd: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: "ignore", windowsHide: true });
    child.on("close", () => resolve());
  });
}

async function main(): Promise<void> {
  const root = process.argv[2];
  if (!root) {
    console.error("нужен путь: scripts/measure.ts <путь-репо>");
    process.exit(2);
  }
  const outputDir = await mkdtemp(join(tmpdir(), "anti-bike-measure-"));

  try {
    console.log("1. Чистый старт jscpd (без скана, только --version):");
    await time("jscpd --version", () => shell("jscpd --version", root));

    console.log(`\n2. Скан ${root} с --changed --baseline-from-ref HEAD:`);
    const first = await time("первый прогон", () =>
      scan({ root, baseRef: "HEAD", outputDir, timeoutMs: 30_000 }),
    );
    console.log(`     клонов: ${first.clones.length}, новых: ${first.clones.filter((c) => c.isNew).length}`);

    console.log("\n3. Повтор того же скана (прогретый кэш ОС):");
    const second = await time("второй прогон", () =>
      scan({ root, baseRef: "HEAD", outputDir, timeoutMs: 30_000 }),
    );
    console.log(`     клонов: ${second.clones.length}`);

    console.log("\n4. Старт Node без jscpd (базовая линия процесса):");
    await time("node -e 0", () => shell("node -e 0", root));

    const total = first.ms + second.ms;
    console.log(`\nвывод: скан стоит ${first.ms} мс холодный, ${second.ms} мс прогретый`);
    console.log(`        два скана в тестах подряд: ${total} мс`);
  } finally {
    await rm(outputDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}

await main();
