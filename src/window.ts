/**
 * Окно работы агента из транскрипта Claude Code.
 *
 * Автор 2026-11-01: «стоп хуке не видно будет что это не решения владельца в
 * решения агента». Замеры показали три вещи, которые здесь и учтены:
 *
 *   1. 95 % транскрипта — прочитанные файлы. В окно они не входят.
 *   2. В записях с ролью user лежит машинный текст: сводка прошлого разговора
 *      после сжатия, системные напоминания, уведомления фоновых задач. Всё это
 *      в сводку идёт как «слова владельца», если не отсечь (1894 КБ против 48).
 *   3. Регекспов нет. Машинный текст узнаётся по виду записи и по литеральным
 *      началам строк, список ниже.
 */

/** Начала текста, который написал не владелец, а машина. */
const MACHINE_PREFIXES = [
  "<task-notification>",
  "<system-reminder>",
  "[SYSTEM NOTIFICATION",
  "<command-name>",
  "<command-message>",
  "<local-command-stdout>",
  "<local-command-caveat>",
  "<cross-session-message",
  "<side-sessions-event>",
  "<ci-monitor-event>",
  "<browsers>",
  "<context_window_protection>",
  "This session is being continued from a previous conversation",
  "Caveat: The messages below were generated",
];

/** Инструменты, чей вход — решение агента, а не прочитанное. */
export const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
/** Предложения владельцу: рождаются в вызове, а не в тексте. */
export const PROPOSAL_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

export type Author = "owner" | "agent" | "agent-wrote" | "agent-proposed";

export interface Turn {
  author: Author;
  text: string;
  /** Имя инструмента для вызовов агента. */
  tool?: string;
}

interface TranscriptRecord {
  type?: string;
  isCompactSummary?: boolean;
  isMeta?: boolean;
  message?: { role?: string; content?: unknown };
}

export function isMachineText(text: string): boolean {
  const head = text.trimStart();
  for (const prefix of MACHINE_PREFIXES) {
    if (head.startsWith(prefix)) return true;
  }
  return false;
}

function sizeOf(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (value === null || value === undefined) return 0;
  return JSON.stringify(value).length;
}

function textBlocks(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: string; text?: string };
    if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
  }
  return parts;
}

function hasToolResult(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) => block && typeof block === "object" && (block as { type?: string }).type === "tool_result",
  );
}

/** Разбирает одну запись транскрипта в ходы. Прочитанное отбрасывает. */
export function readRecord(record: TranscriptRecord): Turn[] {
  const turns: Turn[] = [];
  const role = record.message?.role ?? record.type;
  const content = record.message?.content;

  if (record.type === "user" || role === "user") {
    if (hasToolResult(content)) return turns;
    if (record.isCompactSummary) return turns;
    if (record.isMeta) return turns;
    for (const text of textBlocks(content)) {
      if (text.trim() === "") continue;
      if (isMachineText(text)) continue;
      turns.push({ author: "owner", text });
    }
    return turns;
  }

  if (record.type !== "assistant") return turns;
  if (!Array.isArray(content)) return turns;

  // Запись без вызова инструмента — конец хода агента, это и есть Stop.
  const calledTool = content.some(
    (block) => block && typeof block === "object" && (block as { type?: string }).type === "tool_use",
  );

  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: string; text?: string; name?: string; input?: unknown };
    if (item.type === "text" && typeof item.text === "string" && item.text.trim() !== "") {
      turns.push({ author: "agent", text: item.text });
      continue;
    }
    if (item.type !== "tool_use") continue;
    const name = item.name ?? "?";
    if (PROPOSAL_TOOLS.has(name)) {
      turns.push({ author: "agent-proposed", text: `${name}: ${JSON.stringify(item.input)}`, tool: name });
      continue;
    }
    if (WRITE_TOOLS.has(name)) {
      const input = (item.input ?? {}) as {
        file_path?: string;
        content?: string;
        old_string?: string;
        new_string?: string;
      };
      const body = input.content ?? input.new_string ?? "";
      turns.push({
        author: "agent-wrote",
        text: `${input.file_path ?? "?"} (${body.length} знаков)\n${body.slice(0, 400)}`,
        tool: name,
      });
      continue;
    }
    turns.push({ author: "agent-proposed", text: `${name}(${sizeOf(item.input)} знаков)`, tool: name });
  }
  if (!calledTool) turns.push({ author: "agent", text: "", tool: "__stop__" });
  return turns;
}

/** Разбирает транскрипт целиком. Битые строки пропускаются, не роняя разбор. */
export function readTranscript(raw: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let record: TranscriptRecord;
    try {
      record = JSON.parse(line) as TranscriptRecord;
    } catch {
      continue;
    }
    turns.push(...readRecord(record));
  }
  return turns;
}

/**
 * Окно работы: ходы от начала до последнего Stop.
 *
 * В сводку идут ответы агента и его вызовы. Реплики владельца в текст сводки не
 * попадают — автор сказал их не передавать, — но их наличие возвращается
 * отдельно: по нему видно, что владелец в этом окне что-то решал.
 */
export interface AgentWindow {
  /** Текст для сводки: только агент и его вызовы. */
  text: string;
  /** Ответов агента в окне. */
  agentTurns: number;
  /** Был ли владелец в окне и что сказал: для замера, не для сводки. */
  ownerSaid: string[];
}

export function buildAgentWindow(turns: Turn[]): AgentWindow {
  const parts: string[] = [];
  const ownerSaid: string[] = [];
  let agentTurns = 0;
  for (const turn of turns) {
    if (turn.author === "owner") {
      ownerSaid.push(turn.text);
      continue;
    }
    if (turn.author === "agent") {
      if (turn.tool === "__stop__") continue;
      agentTurns += 1;
      parts.push(turn.text);
      continue;
    }
    if (turn.author === "agent-wrote") parts.push(`[записал ${turn.text}]`);
    else if (turn.author === "agent-proposed") parts.push(`[вызвал ${turn.text}]`);
    else parts.push(turn.text);
  }
  return { text: parts.join("\n\n"), agentTurns, ownerSaid };
}
