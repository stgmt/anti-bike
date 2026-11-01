/**
 * Контракт разбора ответа jscpd. Ответы взяты из живого прогона 5.4.2,
 * фикстуры лежат рядом в `fixtures/`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { address, buildArgs, onlyNew, parseReport } from "../src/clones.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(HERE, "fixtures", name), "utf8");

describe("buildArgs", () => {
  it("сравнивает с базовой ревизией, а не с прошлым прогоном", () => {
    const args = buildArgs({ root: "carousel", baseRef: "origin/main" });
    const at = args.indexOf("--baseline-from-ref");
    assert.notEqual(at, -1, "без --baseline-from-ref клон из прошлой недели выглядит как новый");
    assert.equal(args[at + 1], "origin/main");
    assert.ok(args.includes("--changed"), "--changed ограничивает скан изменёнными файлами");
  });

  it("добавляет флаги, без которых renamed и gap молча не дают клонов", () => {
    const args = buildArgs({ root: "." });
    // Проверено вживую: без --ignore-identifiers jscpd пишет
    // "no such clones are found without --ignore-identifiers".
    assert.ok(args.includes("--ignore-identifiers"));
    assert.ok(args.includes("--max-gap-lines"));
  });

  it("не просит виды клонов, которые не включены", () => {
    const args = buildArgs({ root: ".", kinds: ["exact"] });
    assert.ok(!args.includes("--ignore-identifiers"));
    assert.ok(!args.includes("--max-gap-lines"));
    assert.equal(args[args.indexOf("--kind") + 1], "exact");
  });
});

describe("parseReport", () => {
  it("разбирает настоящий ответ jscpd 5.4.2", () => {
    const clones = parseReport(fixture("jscpd-5.4.2.json"));
    assert.equal(clones.length, 1);
    const [clone] = clones;
    assert.equal(clone.existing.path, "nodes/page.py");
    assert.equal(clone.fresh.path, "nodes/builds.py");
    assert.equal(clone.fresh.start, 12);
    assert.equal(clone.tokens, 63);
    assert.equal(clone.kind, "renamed");
  });

  it("переводит виндовые разделители пути в прямые", () => {
    const clones = parseReport(fixture("jscpd-5.4.2.json"));
    assert.ok(!clones[0].fresh.path.includes("\\"));
  });

  it("пустой ввод — нет клонов, а не ошибка", () => {
    assert.deepEqual(parseReport(""), []);
  });

  it("битый JSON — ошибка с началом ввода, а не тихий ноль", () => {
    assert.throws(() => parseReport("<html>не отчёт</html>"), /не JSON/);
  });

  it("объект без duplicates — ошибка, а не тихий ноль", () => {
    assert.throws(() => parseReport('{"statistics":{}}'), /duplicates/);
  });
});

describe("onlyNew", () => {
  it("оставляет только клоны, которых не было в базовой ревизии", () => {
    const raw = JSON.stringify({
      duplicates: [
        { firstFile: { name: "a.py", start: 1, end: 9 }, secondFile: { name: "b.py", start: 3, end: 11 }, tokens: 60, kind: "exact", isNew: true },
        { firstFile: { name: "c.py", start: 1, end: 9 }, secondFile: { name: "d.py", start: 3, end: 11 }, tokens: 60, kind: "exact", isNew: false },
      ],
    });
    const fresh = onlyNew(parseReport(raw));
    assert.equal(fresh.length, 1);
    assert.equal(fresh[0].fresh.path, "a.py");
  });
});

describe("address", () => {
  it("называет обе стороны так, чтобы агент нашёл обе", () => {
    const clones = parseReport(fixture("jscpd-5.4.2.json"));
    assert.equal(address(clones[0]), "nodes/builds.py:12 уже есть в nodes/page.py:17");
  });
});
