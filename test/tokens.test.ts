/**
 * AB-20: поиск велосипеда без модели.
 *
 * Признак — структурный клон, взвешенный по редкости токена. Тест держит
 * контракт детектора на подтверждённом случае: своя очередь операций против
 * готового KeyedMutex того же репозитория.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { functionsIn } from "../src/bodies.ts";
import { corpus, countUses, detectBikes, relativeTo } from "../src/detect.ts";
import { identifiers, normalize, rareJaccard, weightedJaccard } from "../src/tokens.ts";

const OWN = `import type { Gate } from './ports';
export class TeamOperationQueue implements Gate {
  private readonly tails = new Map<string, Promise<void>>();
  run<T>(teamName: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(teamName) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(teamName, tail);
    void tail.then(() => {
      if (this.tails.get(teamName) === tail) this.tails.delete(teamName);
    });
    return result;
  }
}`;

const READY = `export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();
  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(key, current);
    await previous;
    try { return await task(); } finally {
      release();
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }
}`;

const UNRELATED = `export function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = n;
  let at = 0;
  while (value >= 1024 && at < units.length - 1) { value /= 1024; at += 1; }
  return value.toFixed(1) + units[at];
}`;

function readyFrom(code: string, source: string) {
  const fns = functionsIn(code, source);
  return fns;
}

describe("AB-20: поиск велосипеда по токенам", () => {
  it("AB-20: имена заменены на классы, структура остаётся", () => {
    const a = normalize("function convert(x) { return helper(x) + 1; }");
    const b = normalize("function other(y) { return mapper(y) + 2; }");
    // Одно и то же строение с разными именами даёт одинаковую последовательность.
    assert.deepEqual(a.seq, b.seq);
    // Числа сводятся к литералу, имена — к ID.
    assert.ok(a.seq.includes("ID"));
    assert.ok(a.seq.includes("LIT"));
  });

  it("AB-20: вес по редкости отделяет настоящую пару от посторонней", () => {
    const corpusFns = [
      ...readyFrom(READY, "ready.ts"),
      ...readyFrom(UNRELATED, "unrelated.ts"),
      ...Array.from({ length: 8 }, (_, i) => ({
        name: `filler${i}`,
        body: "const value = input; if (value) { return value; } return null;",
        source: "filler.ts",
        shape: "",
      })),
    ];
    const c = corpus(corpusFns);
    const own = normalize(functionsIn(OWN, "own.ts")[0]!.body);
    const real = rareJaccard(own, c.tokens[c.functions.findIndex((f) => f.name === "KeyedMutex")]!, c.df, c.functions.length);
    const other = rareJaccard(own, c.tokens[c.functions.findIndex((f) => f.name === "formatBytes")]!, c.df, c.functions.length);
    assert.ok(real > other, `настоящая пара ${real} должна быть выше посторонней ${other}`);
  });

  it("AB-20: при равном строении решает предмет, а не форма", () => {
    const ownFns = functionsIn(OWN, "own.ts");
    assert.ok(ownFns.some((f) => f.name === "TeamOperationQueue"));
    const words = identifiers(ownFns[0]!.body);
    assert.ok(words.has("tails"));
    // Посторонняя функция про байты не делит словарь с очередью.
    const unrelated = identifiers(UNRELATED);
    let common = 0;
    for (const w of unrelated) if (words.has(w)) common += 1;
    assert.ok(common < unrelated.size / 2);
  });

  it("AB-20: детектор находит свою очередь против готовой и молчит на посторонней", () => {
    const readyFns = [...readyFrom(READY, "ready.ts"), ...readyFrom(UNRELATED, "unrelated.ts")];
    const window = functionsIn(OWN, "own.ts")
      .filter((f) => f.name === "TeamOperationQueue")
      .map((fn) => ({ fn, via: "Write" as const }));
    const c = corpus(readyFns);
    const uses = new Map([
      ["KeyedMutex", 25],
      ["formatBytes", 21],
      ["TeamOperationQueue", 0],
    ]);
    const result = detectBikes(window, c, { uses, minTokens: 10 });
    assert.equal(result.verdicts.length, 1);
    assert.equal(result.verdicts[0]!.ready, "KeyedMutex");
    assert.equal(result.verdicts[0]!.ownUses, 0);
    assert.equal(result.verdicts[0]!.readyUses, 25);
  });

  it("AB-20: имя, которое в репозитории уже есть, велосипедом не считается", () => {
    const readyFns = readyFrom(READY, "ready.ts");
    const window = functionsIn(READY, "own.ts").map((fn) => ({ fn, via: "Write" as const }));
    const result = detectBikes(window, corpus(readyFns), { uses: new Map(), minTokens: 10 });
    assert.equal(result.verdicts.length, 0);
  });

  it("AB-20: короткое тело не сравнивается — структуры в нём нет", () => {
    const readyFns = readyFrom(READY, "ready.ts");
    const window = [{ fn: { name: "tiny", body: "return { ok: true };", source: "x.ts", shape: "" }, via: "Write" as const }];
    const result = detectBikes(window, corpus(readyFns), { uses: new Map() });
    assert.equal(result.verdicts.length, 0);
  });

  it("AB-20: путь из чужого чекаута приводится к корню репозитория", () => {
    assert.equal(relativeTo("E:/tmp/pub/merge/src/a/b.ts", "E:/repos/agent-teams-ai"), "src/a/b.ts");
    assert.equal(relativeTo("E:/repos/agent-teams-ai/src/a/b.ts", "E:/repos/agent-teams-ai"), "src/a/b.ts");
  });

  it("AB-20: вес по кратности и вес по редкости — разные числа", () => {
    const a = normalize("if (a) { return b; } return c;");
    const b = normalize("if (x) { return y; } return z;");
    const df = new Map([
      ["if", 100],
      ["(", 100],
      [")", 100],
      ["{", 100],
      ["}", 100],
      ["return", 100],
      ["ID", 5],
      [";", 100],
    ]);
    assert.ok(Math.abs(weightedJaccard(a, b) - 1) < 1e-5);
    // Редкий токен ID весит, частые — нет. Обе стороны совпадают по нему,
    // поэтому пара получает единицу.
    assert.ok(Math.abs(rareJaccard(a, b, df, 100) - 1) < 1e-5);
    // А вот если редкий токен есть только у одной стороны, вес решает.
    const c = normalize("if (a) { return b; }");
    assert.ok(rareJaccard(a, c, df, 100) < 0.99);
  });

  it("AB-20: частоты считаются по всему репозиторию", () => {
    const uses = countUses(["const a = KeyedMutex();", "KeyedMutex.run()"]);
    assert.equal(uses.get("KeyedMutex"), 2);
  });

  it("AB-20: тело питоновской функции — по отступам, а не по первой фигурной скобке", () => {
    const py = [
      "class Service:",
      "    def _image(self, digest):",
      '        return "data:image/png;base64," + base64.b64encode(self.artifacts.read(digest)).decode("ascii")',
      "",
      "    async def _pin_plan(self, digest, scenes, historical):",
      "        children = [] if historical is None else historical",
      "        for index in (1, 2):",
      '            child = Model.model_validate({"version": "v1", "model": "m"})',
      "        return children",
    ].join("\n");
    const fns = functionsIn(py, "service.py");
    const image = fns.find((f) => f.name === "_image");
    const pin = fns.find((f) => f.name === "_pin_plan");
    assert.ok(image && pin);
    // Тело — свои строки, а не первый попавшийся словарь из соседнего метода.
    assert.ok(image.body.includes("b64encode"));
    assert.ok(!image.body.includes('"version"'));
    assert.ok(pin.body.includes("children = []"));
    assert.ok(pin.body.includes("for index in (1, 2):"));
  });

  it("AB-20: заглушка протокола `def f(...): ...` не получает чужое тело", () => {
    const py = [
      "class Port:",
      "    async def boundary(self, digest): ...",
      "",
      "    async def inspect(self, digest):",
      "        return await self.backend.read(digest)",
    ].join("\n");
    const fns = functionsIn(py, "ports.py");
    const stub = fns.find((f) => f.name === "boundary");
    assert.equal(stub, undefined);
  });
});
