/**
 * Что окно записало в конкретный файл — целиком.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const transcript = process.argv[2]!;
const want = process.argv[3]!;
const lines = createInterface({ input: createReadStream(transcript, { encoding: "utf8" }), crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.includes("tool_use")) continue;
  let rec: any;
  try {
    rec = JSON.parse(line);
  } catch {
    continue;
  }
  const c = rec.message?.content;
  if (!Array.isArray(c)) continue;
  for (const b of c) {
    if (b?.type !== "tool_use") continue;
    const p = String(b.input?.file_path ?? "").split("\\").join("/");
    if (!p.includes(want)) continue;
    const body = typeof b.input?.content === "string" ? b.input.content : typeof b.input?.new_string === "string" ? b.input.new_string : "";
    console.log(`### ${b.name} ${p} (${body.length})`);
    console.log(body.slice(0, 1600));
  }
}
