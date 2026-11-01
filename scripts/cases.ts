/**
 * Кандидаты во вторую фикстуру: подтверждённые велосипеды из разных репо.
 *
 * Подтверждённый — автор прямо назвал это велосипедом. Для каждого случая
 * ищем окно, где агент это сделал, и способ проверки, который отсекает
 * подделку: есть ли названное в коде репозитория.
 *
 * Запуск: node --experimental-strip-types scripts/cases.ts
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "C:/Users/stigm/.claude/projects";

/** Случаи: репо, цитата автора, что агент построил своими руками. */
const CASES = [
  {
    key: "tokenplan-effort-probe",
    project: "E--repos-tokenplan",
    quote: "накостылял навелосипед",
    built: "createAnthropicEffortProbe, recordAnthropicEffortOutcome, probeAnthropicEffort",
    instead: "проверка каталога моделей и штатный вызов провайдера",
    repo: "E:/repos/tokenplan",
  },
  {
    key: "carousel-runcontext",
    project: "E--repos-carousel-demo",
    quote: "предложил не по сдк работать а завелосипедить",
    built: "RunContext",
    instead: "langgraph.StateGraph(context_schema=…) и Runtime[Context]",
    repo: "E:/repos/carousel-demo",
  },
];

interface Raw {
  type?: string;
  isCompactSummary?: boolean;
  isMeta?: boolean;
  message?: { role?: string; content?: unknown };
}

interface Piece {
  who: "owner" | "agent" | "tool";
  text: string;
  tool?: string;
}

function pieces(raw: string): Piece[] {
  const out: Piece[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let record: Raw;
    try {
      record = JSON.parse(line) as Raw;
    } catch {
      continue;
    }
    if (record.type === "api-request-blob" || record.isCompactSummary || record.isMeta) continue;
    const content = record.message?.content;
    const role = record.message?.role ?? record.type;
    if (record.type === "user" || role === "user") {
      if (Array.isArray(content) && content.some((b) => (b as { type?: string }).type === "tool_result")) continue;
      const text = typeof content === "string" ? content : "";
      if (text.trim() !== "" && !text.startsWith("<")) out.push({ who: "owner", text });
      continue;
    }
    if (record.type !== "assistant" || !Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const item = block as { type?: string; text?: string; name?: string; input?: Record<string, unknown> };
      if (item.type === "text" && (item.text ?? "").trim() !== "") {
        out.push({ who: "agent", text: item.text ?? "" });
        continue;
      }
      if (item.type !== "tool_use") continue;
      const input = item.input ?? {};
      const body = (input.content ?? input.new_string ?? input.command ?? input.code ?? "") as unknown;
      out.push({ who: "tool", text: typeof body === "string" ? body : JSON.stringify(body), tool: item.name ?? "?" });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const summary: Record<string, unknown>[] = [];
  for (const item of CASES) {
    const dir = join(ROOT, item.project);
    let found = false;
    for (const file of (await readdir(dir)).filter((name) => name.endsWith(".jsonl"))) {
      if (found) break;
      const raw = await readFile(join(dir, file), "utf8");
      if (!raw.includes(item.quote)) continue;
      const list = pieces(raw);
      const at = list.findIndex((turn) => turn.who === "owner" && turn.text.includes(item.quote));
      if (at < 0) continue;
      let start = at - 1;
      while (start >= 0 && list[start].who !== "owner") start -= 1;
      start += 1;
      const window = list.slice(start, at);
      const writes = window.filter(
        (turn) => turn.who === "tool" && ["Write", "Edit", "MultiEdit"].includes(turn.tool ?? ""),
      );
      const execs = window.filter((turn) => turn.who === "tool" && (turn.tool ?? "").startsWith("mcp__"));
      // Правки через python/sed тоже правили файлы: ищем по тексту вызова.
      const shellWrites = window.filter(
        (turn) => turn.tool === "Bash" && /open\(p,\s*'w'|>>|> .*\.(ts|py|tsx)|sed -i/.test(turn.text),
      );
      const text = window.map((turn) => (turn.who === "tool" ? `[${turn.tool}] ${turn.text}` : turn.text)).join("\n\n");
      const named = item.built.split(", ").filter((name) => text.includes(name));

      await writeFile(`bench/case-${item.key}.txt`, text, "utf8");
      summary.push({
        key: item.key,
        project: item.project,
        quote: item.quote,
        windowChars: text.length,
        turns: window.length,
        writes: writes.length,
        shellWrites: shellWrites.length,
        mcpCalls: execs.length,
        builtNamed: named.length,
        built: item.built,
        instead: item.instead,
      });
      console.log(`${item.key}: окно ${text.length} зн., ходов ${window.length}, `
        + `Write ${writes.length}, правок через оболочку ${shellWrites.length}, mcp ${execs.length}, `
        + `имён найдено ${named.length}/${item.built.split(", ").length}`);
      console.log(`  ${named.join(", ") || "имён не найдено"}`);
      found = true;
    }
    if (!found) console.log(`${item.key}: окно не найдено`);
  }
  await writeFile("bench/cases.json", JSON.stringify(summary, null, 2), "utf8");
}

await main();
