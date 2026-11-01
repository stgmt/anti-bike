/**
 * Замер MCP-режима jscpd: сколько стоит старт, скан и проверка фрагмента после него.
 *
 * Разница важна: если держать сервер живым, проверка фрагмента не должна
 * пересканировать репозиторий. Это и решает, годится ли `--mcp` для `Stop`-хука.
 *
 * Запуск: node --experimental-strip-types scripts/mcp-probe.ts <путь-репо> <файл-фрагмента>
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

class McpClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(path: string) {
    this.child = spawn("jscpd", ["--mcp", path], { shell: true, windowsHide: true });
    this.child.stdout.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")));
    this.child.stderr.on("data", () => {
      /* jscpd пишет прогресс в stderr, он тут не нужен */
    });
  }

  private onData(text: string): void {
    this.buffer += text;
    let index = this.buffer.indexOf("\n");
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf("\n");
      if (line === "") continue;
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof message.id !== "number") continue;
      const waiter = this.pending.get(message.id);
      if (!waiter) continue;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? "ошибка MCP"));
      else waiter.resolve(message.result);
    }
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${payload}\n`);
    });
  }

  notify(method: string): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  close(): void {
    this.child.stdin.end();
    this.child.kill();
  }
}

async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const value = await work();
  console.log(`  ${label}: ${Math.round(performance.now() - started)} мс`);
  return value;
}

async function main(): Promise<void> {
  const [path, snippetPath] = process.argv.slice(2);
  if (!path || !snippetPath) {
    console.error("нужно: scripts/mcp-probe.ts <путь-репо> <файл-фрагмента>");
    process.exit(2);
  }
  const code = await readFile(snippetPath, "utf8");

  console.log("1. Старт сервера и initialize:");
  const client = new McpClient(path);
  await timed("initialize", () =>
    client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "anti-bike-probe", version: "1" },
    }),
  );
  client.notify("notifications/initialized");

  console.log("\n2. Список инструментов:");
  const tools = (await timed("tools/list", () => client.request("tools/list", {}))) as {
    tools: { name: string }[];
  };
  console.log(`     инструменты: ${tools.tools.map((tool) => tool.name).join(", ")}`);

  console.log("\n3. check_duplication на прогретом сервере (три раза подряд):");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = (await timed(`проверка ${attempt}`, () =>
      client.request("tools/call", {
        name: "check_duplication",
        arguments: { code, format: "python", kinds: ["exact", "renamed"] },
      }),
    )) as { content?: { text?: string }[] };
    const text = result.content?.[0]?.text ?? "";
    try {
      const parsed = JSON.parse(text) as { count?: number; duplications?: unknown[] };
      console.log(`     клонов: ${parsed.count}, отдано: ${parsed.duplications?.length ?? 0}`);
    } catch {
      console.log(`     не JSON: ${text.slice(0, 200)}`);
    }
  }

  console.log("\n4. check_current_directory после правки:");
  const rescanned = (await timed("пересканировать", () =>
    client.request("tools/call", { name: "check_current_directory", arguments: {} }),
  )) as { content?: { text?: string }[] };
  const text = rescanned.content?.[0]?.text ?? "";
  try {
    const parsed = JSON.parse(text) as { clones?: number; files?: number };
    console.log(`     файлов: ${parsed.files}, клонов: ${parsed.clones}`);
  } catch {
    console.log(`     не JSON: ${text.slice(0, 200)}`);
  }

  client.close();
}

await main();
