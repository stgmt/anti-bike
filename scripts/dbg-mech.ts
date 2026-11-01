import { buildReadyContext } from "../src/context.ts";

const ready = await buildReadyContext("E:/repos/carousel-demo/carousel", "E:/repos/carousel-demo/uv.lock");
console.log("механизмов:", ready.mechanisms.length);
for (const entry of ready.mechanisms) {
  console.log(`  ${entry.library.padEnd(16)} ${entry.name.padEnd(28)} ${entry.purpose.slice(0, 60)}`);
}
