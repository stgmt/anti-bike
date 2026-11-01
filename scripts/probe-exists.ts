/**
 * За сколько находится названная сущность в репозитории.
 *
 * Автор: «я рассчитывал что уже передается аст тул для просмотра кода для этого
 * за миллисекунды». Здесь три способа и их честное время на настоящем репо
 * carousel-demo (110 файлов .py, 80 тыс. строк).
 *
 * Запуск: node --experimental-strip-types scripts/probe-exists.ts
 */

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const REPO = "E:/repos/carousel-demo";

/** Сущности из настоящих находок: что должно найтись и что нет. */
const NAMES = [
  { name: "FigureVerdicts", expect: true },
  { name: "figure_places", expect: true },
  { name: "ReaderProfile", expect: true },
  { name: "load_reader", expect: true },
  { name: "RunContext", expect: false },
  { name: "ReaderExamples", expect: false },
  { name: "probe_r", expect: false },
  { name: "StepContext", expect: false },
];

function ms(started: number): string {
  return `${(performance.now() - started).toFixed(1)} мс`;
}

/** 1. Способ первый: обход файлов в памяти, поиск подстроки. */
async function inMemoryWalk(): Promise<Map<string, string>> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "runs" || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".py")) files.push(full);
    }
  }
  await walk(REPO);
  const found = new Map<string, string>();
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const { name } of NAMES) {
      if (found.has(name)) continue;
      if (text.includes(name)) found.set(name, file.replace(REPO + "/", ""));
    }
  }
  return found;
}

async function main(): Promise<void> {
  // Способ 1: обход в памяти.
  let started = performance.now();
  const memory = await inMemoryWalk();
  const memoryMs = ms(started);
  console.log(`обход файлов в памяти: ${memoryMs}`);
  for (const { name, expect } of NAMES) {
    const where = memory.get(name);
    const ok = (where !== undefined) === expect;
    console.log(`  ${ok ? "верно " : "ОШИБКА"} ${name.padEnd(16)} ${where ?? "не найден"}`);
  }

  // Способ 2: ripgrep по требованию, по одному имени.
  console.log("\nripgrep по одному имени:");
  started = performance.now();
  for (const { name } of NAMES) {
    const t0 = performance.now();
    let hit = "";
    try {
      const { stdout } = await run("rg", ["-l", "--type", "py", "-F", name, REPO]);
      hit = stdout.split("\n").filter(Boolean)[0] ?? "";
    } catch {
      hit = "";
    }
    console.log(`  ${name.padEnd(16)} ${hit ? hit.split(/[\\/]/).slice(-2).join("/") : "не найден"}  ${ms(t0)}`);
  }
  console.log(`  всего на ${NAMES.length} имён: ${ms(started)}`);

  // Способ 3: один заход с несколькими шаблонами.
  console.log("\nripgrep одним заходом, все имена:");
  started = performance.now();
  const pattern = NAMES.map((item) => item.name).join("|");
  const { stdout } = await run("rg", ["--type", "py", "-F", "-e", NAMES[0].name, ...NAMES.slice(1).flatMap((item) => ["-e", item.name]), "--with-filename", "-n", REPO])
    .catch(() => ({ stdout: "" }));
  const lines = stdout.split("\n").filter(Boolean);
  console.log(`  строк найдено ${lines.length}, ${ms(started)}`);
  const seen = new Set<string>();
  for (const line of lines) {
    const file = line.split(":")[0].replace(REPO + "/", "");
    for (const { name } of NAMES) {
      if (seen.has(name) || !line.includes(name)) continue;
      seen.add(name);
      console.log(`  ${name.padEnd(16)} ${file}`);
    }
  }
  void pattern;
}

await main();
