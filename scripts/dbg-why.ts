import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Повторяю логику readPackageSource из src/context.ts и смотрю, где теряется StateGraph.
async function readPackageSource(dir: string, files: string[] = [], depth = 0): Promise<string> {
  if (depth > 4 || files.length >= 120) return "";
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return "";
  }
  for (const entry of entries) {
    if (files.length >= 120) break;
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".py")) {
      files.push(full);
    } else if (entry.isDirectory() && !entry.name.startsWith("__") && !entry.name.startsWith(".")) {
      await readPackageSource(full, files, depth + 1);
    }
  }
  if (depth > 0) return "";
  const parts: string[] = [];
  for (const path of files) {
    try {
      parts.push(await readFile(path, "utf8"));
    } catch {
      continue;
    }
  }
  return parts.join("\n");
}

function describeFromDocstring(source: string, name: string): string {
  const pattern = new RegExp(
    `(?:class|def)\\s+${name}\\s*[(:][\\s\\S]{0,400}?(?:"""|''')([\\s\\S]{0,300}?)(?:"""|''')`,
    "m",
  );
  const match = pattern.exec(source);
  if (!match) return "";
  const first = match[1].split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  return first.slice(0, 200);
}

const dir = "E:/repos/carousel-demo/.venv/Lib/site-packages/langgraph";
const files: string[] = [];
const source = await readPackageSource(dir, files, 0);
console.log("файлов:", files.length, "символов:", source.length);
console.log("в источнике есть 'class StateGraph':", source.includes("class StateGraph"));
console.log("в источнике есть 'graph/state.py':", files.some((f) => f.replaceAll("\\", "/").endsWith("graph/state.py")));

for (const name of ["GraphRecursionError", "AsyncSqliteSaver", "GraphBubbleUp", "RetryPolicy", "StateGraph", "Command", "interrupt"]) {
  const purpose = describeFromDocstring(source, name);
  console.log(`${name.padEnd(20)} ${purpose.slice(0, 70) || "— НЕТ"}`);
}
