/**
 * Проверка существования (AB-12).
 *
 * Правило автора 2026-11-01: «Существование проверять кодом. Названа сущность —
 * ищу её в репозитории. Есть → это работа, не велосипед».
 *
 * Что проверяется здесь и почему именно так:
 *
 *   \r от ripgrep — дорогой дефект: на Windows он молча отбрасывал все строки,
 *   кроме последней, и объявленный код считался отсутствующим. Ошибка эта
 *   переворачивала вердикт в опасную сторону, поэтому проверяется напрямую;
 *
 *   `--type py` не видел TypeScript вовсе — тот же эффект на другом языке;
 *
 *   несуществующий корень — «проверка не состоялась», а не «ничего нет».
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { declarationArgs, declaredKind, nameIn, parseFound } from "../src/exists.ts";

describe("проверка существования", () => {
  it("AB-12: строки с \\r на конце разбираются все, а не одна", () => {
    // Ровно то, что отдаёт ripgrep на Windows: \r\n и последняя строка без \r.
    const raw = [
      "E:/r/a.py:1:class Alpha(Contract):\r",
      "E:/r/b.py:2:class Beta(Contract):\r",
      "E:/r/c.py:3:class Gamma(Contract):",
    ].join("\n");
    const found = parseFound(raw, ["Alpha", "Beta", "Gamma"]);
    assert.equal(found.length, 3, `потеряны объявления: ${found.map((f) => f.name).join(", ")}`);
    assert.deepEqual(found.map((f) => f.name).sort(), ["Alpha", "Beta", "Gamma"]);
  });

  it("AB-12: объявление TypeScript находится, а не только Python", () => {
    const raw = 'E:/r/a.ts:19:export type AuthEvent = {\r\nE:/r/b.ts:53:export function publishEvent(\r';
    const found = parseFound(raw, ["AuthEvent", "publishEvent"]);
    assert.equal(found.length, 2, "имена из .ts не найдены");
    assert.deepEqual(found.map((f) => f.kind).sort(), ["class", "fn"]);
  });

  it("AB-12: TypeScript входит в набор языков поиска", () => {
    const args = declarationArgs(["Alpha"], ["pkg"]);
    const text = args.join(" ");
    assert.ok(text.includes("*.ts"), `поиск не идёт по ts: ${text}`);
    assert.ok(!text.includes("--type py"), "поиск ограничен Python");
  });

  it("AB-12: вызов из середины строки не считается объявлением", () => {
    const raw = "E:/r/a.py:9:    value = class Alpha(Contract):\r";
    assert.equal(parseFound(raw, ["Alpha"]).length, 0, "вызов принят за объявление");
  });

  it("AB-12: объявление чужого имени не приписывается названному", () => {
    const raw = "E:/r/a.py:1:class Alphabet(Contract):\r";
    assert.equal(parseFound(raw, ["Alpha"]).length, 0, "поиск по началу имени");
  });

  it("AB-12: имя достаётся вместе с модификатором объявления", () => {
    assert.equal(nameIn("export default class RunContext"), "RunContext");
    assert.equal(nameIn("  async function load"), "load");
    assert.equal(nameIn("const effortProbes = new Map()"), "effortProbes");
    assert.equal(nameIn("class Storyboard(Contract):"), "Storyboard");
  });

  it("AB-12: вид объявления называется верно", () => {
    assert.equal(declaredKind("export interface CardSpec {", ["CardSpec"]), "class");
    assert.equal(declaredKind("def find(name):", ["find"]), "fn");
    assert.equal(declaredKind("let effortProbes = new Map()", ["effortProbes"]), "assign");
    assert.equal(declaredKind("return 1", ["return"]), "");
  });
});
