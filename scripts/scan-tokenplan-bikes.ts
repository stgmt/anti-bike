/**
 * Явные велосипеды в транскриптах tokenplan: что агент сам говорил.
 *
 * Вопрос автора: неужели из транскриптов нельзя достать явные велосипеды.
 * Ищем не слово «велосипед» (его говорит владелец), а формулировки агента:
 * «свой», «сам напишу», «готового нет», «придётся реализовать», «в обход».
 *
 * Читаем потоком: файлы по 100–200 МБ.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const DIR = process.argv[2] ?? "C:/Users/stigm/.claude/projects/E--repos-tokenplan";

/** Формулировки, которыми агент сам объявляет обход или своё. */
const MARKERS: [string, RegExp][] = [
  ["свой/свою/своё", /\b(свою|свой|своё|свое|собственн\w+)\s+(реализац|проверк|обёртк|обертк|механизм|слой|зонд|probe|мост|адаптер)/gi],
  ["готового нет", /(готового|такого)\s+нет|нет\s+(готового|подходящего|штатного)/gi],
  ["придётся реализовать", /прид[её]тся\s+(реализов|написать|сделать|завести)/gi],
  ["в обход", /в\s+обход|обходн\w+\s+путь|обойти\s+(ограничен|проверк)/gi],
  ["костыль", /костыл/gi],
  ["вместо", /вместо\s+(того,?\s*чтобы|штатн|готов|существующ|через)/gi],
];

interface Found { file: string; markers: Map<string, number>; samples: string[] }

async function scan(file: string): Promise<Found | null> {
  const out: Found = { file, markers: new Map(), samples: [] };
  const stream = createReadStream(`${DIR}/${file}`, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.length < 40 || !line.includes('"assistant"')) continue;
    let rec: any;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.type !== "assistant") continue;
    const content = rec.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== "text" || typeof block.text !== "string") continue;
      const text = block.text;
      for (const [name, re] of MARKERS) {
        re.lastIndex = 0;
        const hits = text.match(re);
        if (!hits) continue;
        out.markers.set(name, (out.markers.get(name) ?? 0) + hits.length);
        if (out.samples.length < 6) {
          const at = text.search(re);
          if (at >= 0) out.samples.push(`${name}: …${text.slice(Math.max(0, at - 120), at + 200).replace(/\s+/g, " ")}…`);
        }
      }
    }
  }
  return out.markers.size > 0 ? out : null;
}

const { readdir } = await import("node:fs/promises");
const files = (await readdir(DIR)).filter((n) => n.endsWith(".jsonl"));
let total = 0;
for (const file of files) {
  const found = await scan(file);
  if (!found) { console.log(`${file.slice(0,8)}: ничего`); continue; }
  const sum = [...found.markers.values()].reduce((a, b) => a + b, 0);
  total += sum;
  console.log(`\n=== ${file.slice(0, 8)}: ${sum} попаданий ===`);
  console.log(`  ${[...found.markers.entries()].map(([k, v]) => `${k}×${v}`).join(", ")}`);
  for (const s of found.samples.slice(0, 3)) console.log(`  · ${s.slice(0, 240)}`);
}
console.log(`\nвсего: ${total}`);
