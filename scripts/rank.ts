import { buildReadyContext } from "../src/context.ts";
const ready = await buildReadyContext("E:/repos/carousel-demo/carousel", "E:/repos/carousel-demo/uv.lock");
console.log("механизмов:", ready.mechanisms.length, "| символов:", ready.size);
const want = ["StateGraph", "Runtime", "interrupt", "Command", "AsyncSqliteSaver", "ToolStrategy"];
for (const name of want) {
  const hit = ready.mechanisms.find((m) => m.name === name);
  console.log(`  ${name.padEnd(18)} ${hit ? "ЕСТЬ: " + hit.purpose.slice(0, 60) : "нет"}`);
}
