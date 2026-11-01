/**
 * Живая проверка гейта целиком: jscpd MCP + список готового + Drex-Max.
 *
 * Запуск: node --experimental-strip-types scripts/live-check.ts
 * Платно: несколько вызовов модели на центы.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { classify } from "../src/classify.ts";
import { buildReadyContext } from "../src/context.ts";
import { runGate } from "../src/gate.ts";
import { JscpdMcp } from "../src/mcp.ts";

const REPO = "E:/repos/carousel-demo";
const CASES = join(import.meta.dirname, "..", "test", "fixtures", "turns.json");

interface Turn {
  id: string;
  label: "positive" | "hard_negative" | "negative";
  message: string;
  code: string;
}

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("нет OPENROUTER_API_KEY в окружении");
  return key;
}

async function main(): Promise<void> {
  const turns = JSON.parse(await readFile(CASES, "utf8")) as Turn[];
  const ready = await buildReadyContext(join(REPO, "carousel"), join(REPO, "uv.lock"));
  console.log(`список готового: библиотек ${ready.imports.length}`);
  console.log(`размер списка: ${ready.markdown.length} символов\n`);

  const mcp = new JscpdMcp(join(REPO, "carousel"));
  await mcp.start();
  const key = apiKey();

  let total = 0;
  try {
    for (const turn of turns) {
      const result = await runGate(
        { message: turn.message, code: turn.code, stopHookActive: false },
        {
          checkClones: async (code) => (await mcp.check(code, "python")).duplications,
          readyContext: async () => ready.markdown,
          judge: async (text, context) => classify(text, context, { apiKey: key }),
          format: "python",
        },
      );
      total += result.cost;
      console.log(`${turn.id.padEnd(9)} ${turn.label.padEnd(14)} ${result.kind.padEnd(6)} `
        + `score=${result.score === null ? "—" : result.score.toFixed(3).padEnd(6)} `
        + `клоны=${result.duplications.length} `
        + `ms=${result.ms.parse}/${result.ms.mcp}/${result.ms.context}/${result.ms.model}`);
      if (result.error) console.log(`   ошибка: ${result.error}`);
      if (result.kind === "block") {
        console.log(`   причина:\n${result.message.split("\n").map((line) => `     ${line}`).join("\n")}`);
      }
    }
  } finally {
    mcp.close();
  }
  console.log(`\nстоимость: $${total.toFixed(6)}`);
}

await main();
