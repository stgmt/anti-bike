/** Компактный показ ходов для разметки: первые строки текста и код. */

import { readFile } from "node:fs/promises";

interface Turn {
  id: string;
  project: string;
  message: string;
  written: string;
  edited: string;
  files: string[];
  label: string | null;
}

const files = process.argv.slice(2);
for (const file of files) {
  const turns = JSON.parse(await readFile(file, "utf8")) as Turn[];
  console.log(`\n######## ${file}: ${turns.length} ########`);
  for (const turn of turns) {
    const code = turn.written || turn.edited;
    const head = turn.message.replace(/\s+/g, " ").slice(0, 150);
    const codeHead = code.replace(/\s+/g, " ").slice(0, 110);
    console.log(`\n[${turn.id}] ${turn.files[0] ?? "?"}`);
    console.log(`  текст: ${head}`);
    if (code) console.log(`  код(${code.length}): ${codeHead}`);
  }
}
