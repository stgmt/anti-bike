import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const DIR = "E:/repos/carousel-demo/.venv/Lib/site-packages/langgraph";
const TARGETS = ["StateGraph", "Runtime", "interrupt", "Command", "AsyncSqliteSaver"];

async function files(dir: string, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".py")) out.push(full);
    else if (entry.isDirectory() && !entry.name.startsWith("__")) out.push(...(await files(full, depth + 1)));
  }
  return out;
}

const all = await files(DIR);
console.log("файлов .py в langgraph:", all.length);

for (const target of TARGETS) {
  const re = new RegExp(`(?:class|def)\\s+${target}\\s*[(:]`, "m");
  const hits = all.filter((file) => re.test("")); // placeholder
  let found = "";
  let file = "";
  for (const path of all) {
    const text = await readFile(path, "utf8");
    if (re.test(text)) {
      file = path.replaceAll("\\", "/").split("/site-packages/")[1];
      const idx = text.search(re);
      found = text.slice(idx, idx + 320).replace(/\s+/g, " ");
      break;
    }
  }
  console.log(`\n${target}: ${file || "НЕ НАЙДЕН"}`);
  if (found) console.log(`  ${found.slice(0, 220)}`);
}
