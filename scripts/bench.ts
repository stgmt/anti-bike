/**
 * Евал гейта на размеченных настоящих ходах.
 *
 * Считает точность, полноту, ложные блокировки, долю дошедших до модели,
 * время по слоям и стоимость. Разметка читается из поля `label`.
 *
 * Запуск: OPENROUTER_API_KEY=... node --experimental-strip-types scripts/bench.ts bench/*.json
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { readCapabilities, resolveCapabilities } from "../src/capabilities.ts";
import { classify } from "../src/classify.ts";
import { buildReadyContext } from "../src/context.ts";
import { JscpdMcp } from "../src/mcp.ts";
import { shouldCheck } from "../src/intent.ts";

interface Turn {
  id: string;
  project: string;
  message: string;
  written: string;
  edited: string;
  files: string[];
  label: "bike" | "ok" | null;
  note: string;
}

/** Какие возможности брать для проекта: у каждого свой список. */
const PROJECT_ROOTS: Record<string, string> = {
  "E--repos-carousel-demo": "E:/repos/carousel-demo",
  "E--repos-tokenplan": "E:/repos/tokenplan",
};

interface Row {
  id: string;
  label: string;
  verdict: "block" | "skip" | "error";
  score: number | null;
  clones: number;
  ms: number;
  cost: number;
}

function percentile(values: number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(share * sorted.length));
  return sorted[index];
}

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("нужно: scripts/bench.ts <набор.json>...");
    process.exit(2);
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("нет OPENROUTER_API_KEY");

  const turns: Turn[] = [];
  for (const file of files) {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Turn[];
    turns.push(...parsed);
  }
  const labelled = turns.filter((turn) => turn.label !== null);
  console.log(`ходов всего: ${turns.length}, размечено: ${labelled.length}`);
  if (labelled.length === 0) {
    console.log("разметки нет: сначала проставить label в файлах набора");
    return;
  }

  // Списки возможностей по проектам.
  const contexts = new Map<string, string>();
  for (const [project, root] of Object.entries(PROJECT_ROOTS)) {
    const capabilities = await resolveCapabilities(root, async () => {
      const generated = await buildReadyContext(join(root, "carousel"), join(root, "uv.lock"));
      return generated.markdown;
    });
    contexts.set(project, capabilities.markdown);
    const curated = await readCapabilities(root);
    console.log(`  ${project}: ${capabilities.source}, ${capabilities.size} символов`
      + `${curated === null ? " (курируемого файла нет)" : ""}`);
  }

  // Один сервер jscpd на проект.
  const servers = new Map<string, JscpdMcp>();
  for (const [project, root] of Object.entries(PROJECT_ROOTS)) {
    servers.set(project, new JscpdMcp(root));
  }

  const rows: Row[] = [];
  let spend = 0;
  try {
    for (const turn of labelled) {
      const server = servers.get(turn.project);
      const code = turn.written !== "" ? turn.written : turn.edited;
      if (!shouldCheck(code, turn.message)) {
        rows.push({ id: turn.id, label: turn.label ?? "", verdict: "skip", score: null, clones: 0, ms: 0, cost: 0 });
        continue;
      }
      if (server) {
        try {
          await server.start();
        } catch {
          /* проект недоступен: обходимся без jscpd */
        }
      }
      const started = performance.now();
      let clones = 0;
      try {
        if (server && code !== "") {
          clones = (await server.check(code, turn.files[0]?.endsWith(".ts") ? "typescript" : "python")).count;
        }
      } catch {
        clones = 0;
      }
      const context = contexts.get(turn.project) ?? "";
      const verdict = await classify(turn.message || code.slice(0, 1500), context, { apiKey: key });
      spend += verdict.cost;
      rows.push({
        id: turn.id,
        label: turn.label ?? "",
        verdict: verdict.bike ? "block" : "skip",
        score: verdict.score,
        clones,
        ms: Math.round(performance.now() - started),
        cost: verdict.cost,
      });
      const mark = verdict.bike ? "БЛОК" : "    ";
      console.log(`${turn.id.padEnd(14)} ${(turn.label ?? "").padEnd(5)} ${mark} ${verdict.score.toFixed(3)} клонов=${clones}`);
    }
  } finally {
    for (const server of servers.values()) server.close();
  }

  // Метрики.
  const bikes = rows.filter((row) => row.label === "bike");
  const oks = rows.filter((row) => row.label === "ok");
  const caught = bikes.filter((row) => row.verdict === "block");
  const falseBlocks = oks.filter((row) => row.verdict === "block");
  const reached = rows.filter((row) => row.score !== null);
  const times = reached.map((row) => row.ms);

  console.log("\n" + "=".repeat(56));
  console.log("ИТОГ");
  console.log("=".repeat(56));
  console.log(`велосипедов в наборе:      ${bikes.length}`);
  console.log(`поймано:                   ${caught.length}  полнота ${bikes.length ? ((caught.length / bikes.length) * 100).toFixed(0) : "—"}%`);
  console.log(`обычных ходов:             ${oks.length}`);
  console.log(`ложных блокировок:         ${falseBlocks.length}  ${oks.length ? ((falseBlocks.length / oks.length) * 100).toFixed(0) : "—"}%`);
  const correct = caught.length + (oks.length - falseBlocks.length);
  console.log(`точность:                  ${rows.length ? ((correct / rows.length) * 100).toFixed(0) : "—"}%`);
  console.log(`дошло до модели:           ${reached.length} из ${rows.length}`);
  console.log(`время хода: медиана ${percentile(times, 0.5)} мс, 90-й ${percentile(times, 0.9)} мс`);
  console.log(`стоимость набора:          $${spend.toFixed(5)}`);
  if (falseBlocks.length > 0) {
    console.log("\nложные блокировки:");
    for (const row of falseBlocks) console.log(`  ${row.id}  score=${row.score?.toFixed(3)}  клонов=${row.clones}`);
  }
  if (bikes.length > caught.length) {
    console.log("\nпропущенные велосипеды:");
    for (const row of bikes.filter((item) => item.verdict !== "block")) {
      console.log(`  ${row.id}  score=${row.score?.toFixed(3) ?? "—"}  клонов=${row.clones}`);
    }
  }
}

await main();
