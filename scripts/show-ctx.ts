import { buildReadyContext } from "../src/context.ts";

const ready = await buildReadyContext("E:/repos/carousel-demo/carousel", "E:/repos/carousel-demo/uv.lock");
console.log(`библиотек: ${ready.imports.length}, символов: ${ready.size}\n`);
console.log(ready.markdown);
