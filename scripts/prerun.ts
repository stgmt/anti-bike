/**
 * Черновая разметка: прогон гейта по всему набору без эталона.
 *
 * Нужна, чтобы увидеть распределение: сколько ходов гейт собирается блокировать
 * и на что. Выборку блокировок я читаю глазами — это и есть проверка.
 * Разметка тут не появляется: `label` остаётся null, пока её не проставит человек.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { readCapabilities, resolveCapabilities } from "../src/capabilities.ts";
import { classify } from "../src/classify.ts";
import { buildReadyContext } from "../src/context.ts";
import { JscpdMcp } from "../src/mcp.ts";
import { isCodeFile, shouldCheck } from "../src/intent.ts";

interface Turn {
  id: string;
  project: string;
  message: string;
  written: string;
  edited: string;
  files: string[];
  label: string | null;
}

const ROOTS: Record<string, { root: string; pkg: string }> = {
  "E--repos-carousel-demo": { root: "E:/repos/carousel-demo", pkg: "E:/repos/carousel-demo/carousel" },
  "E--repos-tokenplan": { root: "E:/repos/tokenplan", pkg: "E:/repos/tokenplan" },
};

async function main(): Promise<void> {
  const sets = process.argv.slice(2);
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("нет OPENROUTER_API_KEY");

  const turns: Turn[] = [];
  for (const set of sets) turns.push(...(JSON.parse(await readFile(set, "utf8")) as Turn[]));
  console.log(`ходов: ${turns.length}`);

  const contexts = new Map<string, { text: string; source: string }>();
  for (const [project, place] of Object.entries(ROOTS)) {
    const capabilities = await resolveCapabilities(place.root, async () => {
      const generated = await buildReadyContext(place.pkg, join(place.root, "uv.lock"));
      return generated.markdown;
    });
    contexts.set(project, { text: capabilities.markdown, source: capabilities.source });
    console.log(`  ${project}: список ${capabilities.source}, ${capabilities.size} символов`);
  }

  const servers = new Map<string, JscpdMcp>();
  for (const [project, place] of Object.entries(ROOTS)) servers.set(project, new JscpdMcp(place.pkg));

  const out: unknown[] = [];
  let blocks = 0;
  let reached = 0;
  let spend = 0;
  const times: number[] = [];
  // Результат пишется потоком, а не в конце: прогон на тысячу ходов с таймаутом
  // оболочки иначе теряет всё сделанное (проверено 2026-11-01).
  const dest = join(import.meta.dirname, "..", "bench", "prerun.jsonl");
  const { appendFile, writeFile } = await import("node:fs/promises");
  await writeFile(dest, "");

  try {
    for (const [index, turn] of turns.entries()) {
      const code = turn.written !== "" ? turn.written : turn.edited;
      if (!shouldCheck(code, turn.message)) {
        const row = { id: turn.id, project: turn.project, prerun: { verdict: "skip", reason: "ступень 1" } };
        out.push(row);
        await appendFile(dest, `${JSON.stringify(row)}\n`);
        continue;
      }
      reached += 1;
      const started = performance.now();
      let clones = 0;
      try {
        const server = servers.get(turn.project);
        if (server && code !== "") {
          await server.start();
          const format = isCodeFile(turn.files[0] ?? "") && turn.files[0]?.match(/\.(ts|tsx|js|mjs|cjs)$/) ? "typescript" : "python";
          clones = (await server.check(code, format)).count;
        }
      } catch {
        clones = 0;
      }
      let verdict = { score: 0, bike: false, cost: 0 };
      try {
        verdict = await classify(turn.message || code.slice(0, 1500), contexts.get(turn.project)?.text ?? "", { apiKey: key });
      } catch (error) {
        const row = { id: turn.id, project: turn.project, prerun: { verdict: "error", error: String(error).slice(0, 120) } };
        out.push(row);
        await appendFile(dest, `${JSON.stringify(row)}\n`);
        continue;
      }
      spend += verdict.cost;
      if (verdict.bike) blocks += 1;
      times.push(Math.round(performance.now() - started));
      const row = {
        id: turn.id,
        project: turn.project,
        file: turn.files[0] ?? "",
        bytes: code.length,
        prerun: {
          verdict: verdict.bike ? "block" : "skip",
          score: Number(verdict.score.toFixed(3)),
          clones,
        },
      };
      out.push(row);
      await appendFile(dest, `${JSON.stringify(row)}\n`);
      if ((index + 1) % 100 === 0) {
        console.log(`  ${index + 1}/${turns.length}: блоков ${blocks}, до модели ${reached}`);
      }
    }
  } finally {
    for (const server of servers.values()) server.close();
  }

  times.sort((left, right) => left - right);
  const at = (share: number): number => times[Math.floor(share * times.length)] ?? 0;
  console.log("\n" + "=".repeat(52));
  console.log(`дошло до модели:     ${reached} из ${turns.length}`);
  console.log(`блокировок:          ${blocks} (${((blocks / Math.max(reached, 1)) * 100).toFixed(1)}% дошедших)`);
  console.log(`время хода:          медиана ${at(0.5)} мс, 90-й ${at(0.9)} мс`);
  console.log(`стоимость набора:    $${spend.toFixed(4)}`);
  console.log(`записано:            ${dest}`);
}

await main();
