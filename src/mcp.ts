/**
 * Клиент jscpd в режиме MCP.
 *
 * Замеры 2026-11-01 на пакете `carousel/` (92 файла):
 *   старт сервера (initialize)            856–1430 мс
 *   check_duplication первый раз           11–148 мс
 *   check_duplication повторно               1–11 мс
 *   check_current_directory (перескан)        7–68 мс
 *   для сравнения, CLI -—changed --baseline  5706 мс
 *
 * Поэтому сервер держим живым и проверяем фрагменты, а не сканируем репозиторий
 * на каждом ходе.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/**
 * Один кандидат. Поля сняты живым ответом 2026-11-01, а не по документации:
 * `file` — файл, в котором найден повтор, `fileStartLine`/`fileEndLine` — его
 * границы там. Кусок, который мы подали на проверку, лежит в
 * `snippetStartLine`/`snippetEndLine`.
 */
export interface Duplication {
  /** Файл в проекте, где тот же код уже есть. */
  file: string;
  /** С какой строки того файла начинается совпадение. */
  fileStartLine: number;
  fileEndLine: number;
  /** Границы поданного фрагмента, откуда совпадение взято. */
  snippetStartLine: number;
  snippetEndLine: number;
  kind: string;
  lines: number;
  tokens: number;
}

export interface DuplicationAnswer {
  count: number;
  duplications: Duplication[];
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** Минимальный клиент MCP поверх stdio. Один процесс на репозиторий. */
export class JscpdMcp {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /**
   * Поднимает сервер один раз. Повторный вызов ничего не делает.
   *
   * Таймаут обязателен: на несуществующем пути jscpd не отвечает на `initialize`
   * и не выходит — без него хук зависает насмерть. Замерено 2026-11-01.
   */
  async start(timeoutMs = 15_000): Promise<void> {
    if (this.child) return;
    const child = spawn("jscpd", ["--mcp", this.path], { shell: true, windowsHide: true });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")));
    child.stderr.on("data", () => {
      /* прогресс скана идёт в stderr, он тут не нужен */
    });
    await this.request(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "anti-bike", version: "0.1.0" },
      },
      timeoutMs,
    );
    this.notify("notifications/initialized");
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
        message = JSON.parse(line) as typeof message;
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

  request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    const child = this.child;
    if (!child) return Promise.reject(new Error("сервер не запущен"));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} не ответил за ${timeoutMs} мс`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(`${payload}\n`);
    });
  }

  notify(method: string): void {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  /** Проверка фрагмента кода без пересканирования репозитория. */
  async check(code: string, format: string): Promise<DuplicationAnswer> {
    const result = (await this.request("tools/call", {
      name: "check_duplication",
      arguments: { code, format, kinds: ["exact", "renamed", "similar"] },
    })) as { content?: { text?: string }[] };
    const text = result.content?.[0]?.text ?? "";
    try {
      const parsed = JSON.parse(text) as DuplicationAnswer;
      return { count: parsed.count ?? 0, duplications: parsed.duplications ?? [] };
    } catch {
      throw new Error(`check_duplication вернул не JSON: ${text.slice(0, 200)}`);
    }
  }

  close(): void {
    this.child?.stdin.end();
    this.child?.kill();
    this.child = null;
  }
}
