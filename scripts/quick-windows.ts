import { readFileSync } from "node:fs";
import { readTranscript, buildAgentWindow, type Turn } from "../src/window.ts";

const raw = readFileSync("C:/Users/stigm/.claude/projects/E--repos-carousel-demo/3d9badd2-4ae9-4edc-a417-ea79556687c1.jsonl", "utf8");
const turns = readTranscript(raw);
const MAX = 60_000;
const windows: Turn[][] = [];
let cur: Turn[] = [], size = 0;
for (const t of turns) {
  if (t.author === "owner") { if (cur.length) windows.push(cur); cur = []; size = 0; continue; }
  if (t.tool === "__stop__") continue;
  cur.push(t); size += t.text.length;
  if (size >= MAX) { windows.push(cur); cur = []; size = 0; }
}
if (cur.length) windows.push(cur);
const built = windows.map(buildAgentWindow);
console.log(`окон ${windows.length}, из них с вызовами ${windows.filter(w=>w.some(t=>t.author==='agent-wrote'||t.author==='agent-proposed')).length}`);
console.log(`размер: медиана ${built.map(b=>b.text.length).sort((a,b)=>a-b)[Math.floor(built.length/2)]}, макс ${Math.max(...built.map(b=>b.text.length))}`);
console.log(`\nпервые три окна:`);
for (const b of built.slice(0,3)) console.log(`  ${b.text.length} зн., ответов ${b.agentTurns}: ${b.text.replace(/\s+/g," ").slice(0,120)}`);
