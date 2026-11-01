/**
 * Поиск велосипедов по транскриптам всех сессий.
 *
 * Ищем не слово «велосипед», а признак: агент пишет НОВЫЙ файл, имя которого
 * повторяет то, что обычно даёт библиотека (Adapter, Wrapper, Client, Probe,
 * Helper, Shim, Polyfill, Fallback, Retry, Cache, Queue, Parser, Resolver,
 * Factory, Builder, Scheduler, Pool, Lock, Mutex, Debounce, Throttle).
 *
 * Плюс отдельно: агент сам пишет, что «нет готового» или «придётся написать».
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { readdir } from "node:fs/promises";

const ROOT = "C:/Users/stigm/.claude/projects";
const SUSPECT = /(adapter|wrapper|client|probe|helper|shim|polyfill|fallback|retry|cache|queue|parser|resolver|factory|builder|scheduler|pool|mutex|debounce|throttle|limiter|middleware|interceptor|serializer|validator)\.(ts|tsx|js|py|go)$/i;
const PROSE = /(нет готового|готового нет|не поддерживает|прид[её]тся (написать|реализовать|сделать)|напишу свой|сделаю свой|самописн|не наш[её]л (готов|штатн)|приходится писать)/i;

interface Hit { project: string; file: string; url: string; created: string[]; prose: string[] }

async function scan(project: string, file: string): Promise<Hit | null> {
  const hit: Hit = { project, file, url: "", created: [], prose: [] };
  const dir = project.replace(/^E--/, "E:/").replace(/--/g, "/").replace(/-/g, "/");
  const stream = createReadStream(`${ROOT}/${project}/${file}`, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.length < 60) continue;
    if (!line.includes("tool_use") && !line.includes('"assistant"')) continue;
    let rec: any;
    try { rec = JSON.parse(line); } catch { continue; }
    const content = rec.message?.content;
    if (rec.type !== "assistant" || !Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === "tool_use") {
        const input = b.input ?? {};
        const path = input.file_path ?? input.path ?? "";
        if (typeof path === "string" && SUSPECT.test(path) && b.name === "Write") {
          if (!hit.created.includes(path)) hit.created.push(path);
        }
        // Правки через оболочку: python пишет новый модуль.
        const cmd = typeof input.command === "string" ? input.command : "";
        if (cmd) {
          const m = /(?:open\(|path\s*=\s*['"])([^'"]+\.(?:ts|tsx|py|go))['"]/.exec(cmd);
          if (m && SUSPECT.test(m[1]) && /open\([^)]*['"]w/.test(cmd) && !hit.created.includes(m[1])) {
            hit.created.push(m[1]);
          }
        }
      }
      if (b?.type === "text" && typeof b.text === "string" && PROSE.test(b.text)) {
        const at = b.text.search(PROSE);
        hit.prose.push(b.text.slice(Math.max(0, at - 150), at + 220).replace(/\s+/g, " "));
      }
    }
  }
  return hit.created.length > 0 || hit.prose.length > 0 ? hit : null;
}

const projects = await readdir(ROOT);
let found = 0;
for (const project of projects) {
  let files: string[];
  try { files = (await readdir(`${ROOT}/${project}`)).filter((n) => n.endsWith(".jsonl")); } catch { continue; }
  for (const file of files) {
    const hit = await scan(project, file);
    if (!hit) continue;
    found += 1;
    console.log(`\n### ${project}/${file.slice(0, 8)}`);
    if (hit.created.length) console.log(`  СОЗДАЛ: ${hit.created.slice(0, 6).join(" | ")}`);
    for (const p of hit.prose.slice(0, 2)) console.log(`  слова: ${p.slice(0, 200)}`);
  }
}
console.log(`\nсессий с признаками: ${found}`);
