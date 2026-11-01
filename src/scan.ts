/**
 * Запуск jscpd и чтение его отчёта.
 *
 * jscpd пишет отчёт в каталог, в stdout — только сводка. Поэтому после запуска
 * читаем `<outputDir>/jscpd-report.json`.
 */

import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { buildArgs, parseReport, type Clone, type ScanOptions } from "./clones.ts";

export interface ScanResult {
  clones: Clone[];
  /** Сколько занял весь процесс: старт Node и Rust-движка входит. */
  ms: number;
  /** Код выхода jscpd: 0 — новых клонов нет, 1 — есть. */
  code: number;
  stderr: string;
}

/** Читает отчёт по пути, который получает jscpd; пусто — значит файла нет. */
async function readReport(outputDir: string): Promise<string> {
  const path = join(outputDir, "jscpd-report.json");
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "";
    throw error;
  }
}

/**
 * Прогоняет jscpd и возвращает клоны.
 *
 * Таймаут обязателен: на большом репо с `node_modules` скан может затянуться,
 * а `Stop`-хук не должен держать агента. `jscpd` не умеет останавливаться по
 * времени сам, поэтому убиваем процесс.
 */
export async function scan(options: ScanOptions & { timeoutMs?: number }): Promise<ScanResult> {
  const started = performance.now();
  const outputDir = options.outputDir ?? ".jscpd";
  const args = buildArgs({ ...options, outputDir });

  // Старый отчёт нельзя принять за новый: иначе прошлый прогон даст ложный «чисто».
  await rm(join(outputDir, "jscpd-report.json"), { force: true });

  const { code, stderr } = await run(args, options.root, options.timeoutMs ?? 20_000);
  const raw = await readReport(outputDir);
  const ms = Math.round(performance.now() - started);
  return { clones: parseReport(raw), ms, code, stderr };
}

function run(
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("jscpd", args, { cwd, shell: true, windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`jscpd не уложился в ${timeoutMs} мс`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`jscpd не запустился: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // Код 1 — jscpd нашёл новые клоны при --fail-on-new-clones, это ответ, а не сбой.
      // Всё, что выше, — ошибка.
      if (code === 0 || code === 1) resolve({ code: code ?? 0, stderr });
      else reject(new Error(`jscpd завершился с кодом ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}
