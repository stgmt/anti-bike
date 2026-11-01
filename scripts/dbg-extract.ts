import { readFile } from "node:fs/promises";
import { detectIntent } from "../src/intent.ts";

const p = "C:/Users/stigm/.claude/projects/E--repos-carousel-demo/5991cc66-3b95-43fa-a8ce-5122dd0292c7.jsonl";
const lines = (await readFile(p, "utf8")).split("\n");
let assistant = 0, withText = 0, withTool = 0, promise = 0;
const examples: string[] = [];
for (const line of lines) {
  if (line.trim() === "") continue;
  let r: any;
  try { r = JSON.parse(line); } catch { continue; }
  if (r.type !== "assistant") continue;
  assistant += 1;
  const c = r.message?.content;
  if (!Array.isArray(c)) continue;
  const text = c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n").trim();
  const tools = c.filter((b: any) => b?.type === "tool_use");
  if (text) withText += 1;
  if (tools.some((b: any) => ["Write","Edit","MultiEdit"].includes(b.name))) withTool += 1;
  if (text && detectIntent(text).promise) {
    promise += 1;
    if (examples.length < 3) examples.push(text.slice(0, 100));
  }
}
console.log(`assistant: ${assistant}, с текстом: ${withText}, с Write/Edit: ${withTool}, прошли ступень 1: ${promise}`);
for (const e of examples) console.log("  ·", e.replace(/\n/g, " "));
