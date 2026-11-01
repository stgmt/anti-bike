/**
 * Что за файлы ступень 1 пропускает: по расширению и по размеру.
 *
 * Нужно понять, это шум (планы .md, хендофы) или настоящие упущенные велосипеды.
 */

import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { detectIntent } from "../src/intent.ts";

interface Raw {
  type?: string;
  message?: { content?: unknown };
}

async function main(): Promise<void> {
  const dirs = process.argv.slice(2);
  const byExt = new Map<string, { missed: number; passed: number; bytes: number }>();
  const codeMissed: { file: string; bytes: number; preview: string }[] = [];

  for (const dir of dirs) {
    let files: string[];
    try {
      files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      const lines = (await readFile(join(dir, file), "utf8")).split("\n");
      for (const line of lines) {
        if (line.trim() === "") continue;
        let record: Raw;
        try {
          record = JSON.parse(line) as Raw;
        } catch {
          continue;
        }
        if (record.type !== "assistant") continue;
        const content = record.message?.content;
        if (!Array.isArray(content)) continue;

        let written = "";
        let edited = "";
        let name = "";
        let text = "";
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const item = block as { type?: string; name?: string; text?: string; input?: Record<string, unknown> };
          if (item.type === "text" && typeof item.text === "string") text += item.text;
          if (item.type !== "tool_use") continue;
          const input = item.input ?? {};
          if (typeof input.file_path === "string") name = input.file_path;
          if (item.name === "Write" && typeof input.content === "string") written = input.content;
          if (item.name === "Edit" && typeof input.new_string === "string") edited = input.new_string;
        }
        if (written === "" && edited === "") continue;

        const ext = extname(name).toLowerCase() || "(без)";
        const bucket = byExt.get(ext) ?? { missed: 0, passed: 0, bytes: 0 };
        const candidate = text !== "" ? text : written + "\n" + edited;
        const ok = detectIntent(candidate).promise;
        if (ok) bucket.passed += 1;
        else {
          bucket.missed += 1;
          bucket.bytes += written.length;
          // Интересны только файлы кода: .md и .json гейт трогать не должен.
          if ([".py", ".ts", ".js", ".go", ".rs", ".java", ".cs", ".rb", ".php"].includes(ext)) {
            codeMissed.push({ file: name, bytes: written.length, preview: written.slice(0, 160).replace(/\s+/g, " ") });
          }
        }
        byExt.set(ext, bucket);
      }
    }
  }

  const rows = [...byExt.entries()].sort((left, right) => right[1].missed + right[1].passed - (left[1].missed + left[1].passed));
  console.log("Пропущено ступенью 1, по расширению");
  console.log("=".repeat(64));
  console.log(`${"расш".padEnd(8)} ${"пропущ".padStart(8)} ${"прошло".padStart(8)} ${"доля пропуска".padStart(14)}`);
  for (const [ext, bucket] of rows) {
    const total = bucket.missed + bucket.passed;
    const share = total === 0 ? "—" : `${((bucket.missed / total) * 100).toFixed(0)}%`;
    console.log(`${ext.padEnd(8)} ${String(bucket.missed).padStart(8)} ${String(bucket.passed).padStart(8)} ${share.padStart(14)}`);
  }

  const codeTotal = codeMissed.length;
  const codeBig = codeMissed.filter((item) => item.bytes > 800);
  console.log(`\nпропущенных файлов КОДА: ${codeTotal}, из них крупнее 800 символов: ${codeBig.length}`);
  const biggest = codeBig.sort((left, right) => right.bytes - left.bytes).slice(0, 12);
  for (const item of biggest) {
    console.log(`  ${String(item.bytes).padStart(6)} симв  ${item.file}`);
  }
}

await main();
