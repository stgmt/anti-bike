import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "E:/repos/carousel-demo/.venv/Lib/site-packages/langgraph";

async function walk(dir: string, files: string[], depth: number): Promise<void> {
  if (depth > 4 || files.length >= 120) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= 120) break;
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".py")) files.push(full);
    else if (entry.isDirectory() && !entry.name.startsWith("__") && !entry.name.startsWith(".")) {
      await walk(full, files, depth + 1);
    }
  }
}

const files: string[] = [];
await walk(ROOT, files, 0);
console.log("собрано файлов:", files.length);
console.log("первые 5:", files.slice(0, 5).map((f) => f.split("site-packages")[1]));
console.log("types.py есть:", files.some((f) => f.endsWith("types.py")));
console.log("graph/state.py есть:", files.some((f) => f.replaceAll("\\", "/").endsWith("graph/state.py")));

const source = (await Promise.all(files.map((f) => readFile(f, "utf8")))).join("\n");
console.log("длина источника:", source.length);

for (const name of ["StateGraph", "Runtime", "interrupt", "Command"]) {
  const re = new RegExp(`(?:class|def)\\s+${name}\\s*[(:][\\s\\S]{0,400}?(?:"""|''')`, "m");
  console.log(`${name}: ${re.test(source) ? "НАЙДЕН" : "нет"}`);
}
