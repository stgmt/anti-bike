/**
 * Решение гейта (AB-01, AB-05, AB-06, AB-07, AB-08, AB-10).
 *
 * Порты подменены скриптованными фейками: тесты не ходят в сеть и не тратят деньги.
 * Настоящий jscpd проверен отдельно в `mcp.test.ts`, настоящая фикстура — там же.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runGate, type GateDeps } from "../src/gate.ts";
import type { Duplication } from "../src/mcp.ts";

const BIKE = "Один срез: RunContext — ввести объект «окружение шага» и провести через 16 узлов.";
const REPORT = "Верну цикл на место. Проверку выходных файлов оставил.";
const FIXED = "Штатный механизм беру: StateGraph с context_schema. Новый объект не ввожу.";

function duplication(): Duplication {
  return {
    file: "carousel/graph.py",
    fileStartLine: 235,
    fileEndLine: 250,
    snippetStartLine: 1,
    snippetEndLine: 16,
    kind: "renamed",
    lines: 16,
    tokens: 120,
  };
}

/** Обвязка, которая считает, какие ступени звали. */
function deps(overrides: Partial<GateDeps> = {}) {
  const calls = { clones: 0, context: 0, judge: 0 };
  const base: GateDeps = {
    checkClones: async () => {
      calls.clones += 1;
      return [duplication()];
    },
    readyContext: async () => {
      calls.context += 1;
      return "Модули проекта:\n- graph: граф прогона";
    },
    judge: async () => {
      calls.judge += 1;
      return { score: 0.97, bike: true, ms: 1100, cost: 0.00005, inputTokens: 900, outputTokens: 34, served: "nace-ai/drex-max" };
    },
    format: "python",
    ...overrides,
  };
  return { base, calls };
}

describe("гейт", () => {
  it("AB-01: ход без обещания не зовёт ни jscpd, ни модель", async () => {
    const { base, calls } = deps();
    const result = await runGate({ message: REPORT, code: "", stopHookActive: false }, base);
    assert.equal(result.kind, "skip");
    assert.equal(calls.clones, 0, "jscpd звали зря");
    assert.equal(calls.judge, 0, "модель звали зря");
  });

  it("AB-07: повторный Stop не гоняет проверку заново", async () => {
    const { base, calls } = deps();
    const result = await runGate({ message: BIKE, code: "", stopHookActive: true }, base);
    assert.equal(result.kind, "skip");
    assert.equal(result.reason, "повторный Stop");
    assert.equal(calls.judge, 0, "петля блокировок");
  });

  it("AB-05: модель получает список готового, а не один текст", async () => {
    const { base } = deps();
    let seenReady = "";
    let seenText = "";
    await runGate(
      { message: BIKE, code: "", stopHookActive: false },
      {
        ...base,
        judge: async (text, ready) => {
          seenText = text;
          seenReady = ready;
          return { score: 0.9, bike: true, ms: 1, cost: 0, inputTokens: 0, outputTokens: 0, served: "x" };
        },
      },
    );
    assert.ok(seenReady.includes("Модули проекта"), "список готового не передан");
    assert.ok(seenText.includes("RunContext"), "текст хода не передан");
  });

  it("AB-06: score ниже порога пропускается, даже когда клон найден", async () => {
    const { base } = deps({
      judge: async () => ({ score: 0.49, bike: false, ms: 1, cost: 0, inputTokens: 0, outputTokens: 0, served: "x" }),
    });
    // Код непустой: иначе jscpd не зовут и проверять нечего.
    const result = await runGate(
      { message: BIKE, code: "class X: ...", stopHookActive: false },
      base,
    );
    assert.equal(result.kind, "skip", "порог не применён");
    assert.equal(result.duplications.length, 1, "клон найден, но решает порог");
  });

  it("AB-06: score ровно на пороге блокирует", async () => {
    const { base } = deps({
      judge: async () => ({ score: 0.5, bike: true, ms: 1, cost: 0, inputTokens: 0, outputTokens: 0, served: "x" }),
    });
    const result = await runGate({ message: BIKE, code: "", stopHookActive: false }, base);
    assert.equal(result.kind, "block");
  });

  it("AB-08: причина блокировки называет файл и строку", async () => {
    const { base } = deps();
    const result = await runGate({ message: BIKE, code: "class X: ...", stopHookActive: false }, base);
    assert.equal(result.kind, "block");
    assert.ok(result.message.includes("carousel/graph.py:235"), `адреса нет: ${result.message}`);
  });

  it("AB-08: без клона причина называет механизм, а не молчит", async () => {
    const { base } = deps({ checkClones: async () => [] });
    const result = await runGate({ message: BIKE, code: "", stopHookActive: false }, base);
    assert.equal(result.kind, "block");
    assert.ok(result.message.includes("списком готового"), `нет указания, что делать: ${result.message}`);
  });

  it("AB-10: сбой jscpd не блокирует ход и не прячется", async () => {
    const { base } = deps({ checkClones: async () => { throw new Error("jscpd не запустился"); } });
    const result = await runGate({ message: BIKE, code: "class X: ...", stopHookActive: false }, base);
    assert.equal(result.kind, "skip", "сбой инфраструктуры заблокировал агента");
    assert.match(result.error ?? "", /jscpd не запустился/);
  });

  it("AB-10: сбой модели не блокирует ход", async () => {
    const { base } = deps({ judge: async () => { throw new Error("decisions ответил 429"); } });
    const result = await runGate({ message: BIKE, code: "", stopHookActive: false }, base);
    assert.equal(result.kind, "skip");
    assert.match(result.error ?? "", /429/);
  });

  it("AB-09: замер идёт с раздельным временем слоёв", async () => {
    const { base } = deps();
    const result = await runGate({ message: BIKE, code: "class X: ...", stopHookActive: false }, base);
    assert.equal(typeof result.ms.parse, "number");
    assert.equal(typeof result.ms.mcp, "number");
    assert.equal(typeof result.ms.context, "number");
    assert.equal(typeof result.ms.model, "number");
  });

  it("исправленный ход проходит отсев, но порог его отпускает", async () => {
    const { base } = deps({
      judge: async () => ({ score: 0.02, bike: false, ms: 1, cost: 0, inputTokens: 0, outputTokens: 0, served: "x" }),
    });
    const result = await runGate({ message: FIXED, code: "", stopHookActive: false }, base);
    assert.equal(result.kind, "skip");
    assert.equal(result.score, 0.02);
  });
});
