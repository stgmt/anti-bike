import { readdir } from "node:fs/promises";
const projects = await readdir("C:/Users/stigm/.claude/projects");
let ok = 0, noRepo = 0;
const samples: string[] = [];
for (const p of projects.slice(0, 40)) {
  const base = p.split("--claude-worktrees")[0].replace(/^[eE]--/, "E--");
  const path = base.replace(/^E--/, "E:/").replace(/--/g, "/").replace(/-/g, "/");
  const { existsSync } = await import("node:fs");
  if (existsSync(path)) { ok += 1; if (samples.length < 6) samples.push(`${p} → ${path}`); }
  else noRepo += 1;
}
console.log(`путь найден: ${ok}, нет: ${noRepo}`);
for (const s of samples) console.log("  ", s);
