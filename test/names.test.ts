/**
 * Разбор сводки: что агент предложил вместо готового (AB-13).
 *
 * Замер прогона detect2: из 8 случаев «вместо готового» парсер доставал 2.
 * Терились четыре разных вида, и все четыре — настоящая работа без имени:
 *
 *   «RunContext — вместо …»                          латиница одним словом;
 *   «собственный тест границы импортов — вместо …»   описание;
 *   «Проводка через замыкания — вместо …»            описание;
 *   «самописная отправка запросов — вместо …»        описание.
 *
 * Плюс пятый: заголовок раздела стоит в одной строке с первым случаем.
 * Плюс шестой: несколько случаев идут пунктами через «; - » на одной строке.
 *
 * Почему это дорого: случай, потерянный здесь, не доходит ни до проверки
 * существования, ни до классификатора. Окно жены «чисто» без замера.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { proposedNames } from "../src/judge.ts";

const wrap = (body: string) => `ВМЕСТО ГОТОВОГО — главное\n${body}\n\nСОЗДАЛ НОВОЕ\nмодуль\n\nЗАПИСАЛ\nфайл`;

describe("разбор сводки", () => {
  it("AB-13: имя латиницей достаётся (эталон)", () => {
    const names = proposedNames(
      wrap("RunContext — вместо langgraph.StateGraph(context_schema=…) и Runtime[Context], которые передают зависимости."),
    );
    assert.deepEqual(names, ["RunContext"]);
  });

  it("AB-13: описание работы достаётся, а не только идентификатор", () => {
    const names = proposedNames(
      wrap("собственный тест границы импортов — вместо Ruff (`TID251`), который проверяет запреты по слоям."),
    );
    assert.equal(names.length, 1, `потеряно: ${JSON.stringify(names)}`);
    assert.match(names[0], /собственный тест границы/);
  });

  it("AB-13: заголовок раздела не съедает первый случай", () => {
    const names = proposedNames(
      wrap("**Проводка через замыкания и общий контейнер зависимостей — вместо `Runtime` из SDK.**"),
    );
    assert.equal(names.length, 1, `потеряно: ${JSON.stringify(names)}`);
    assert.ok(!names[0].includes("ВМЕСТО"), `в имя попал заголовок: ${names[0]}`);
    assert.ok(!names[0].startsWith("«"), `кавычка в имени: ${names[0]}`);
  });

  it("AB-13: несколько случаев пунктами на одной строке находятся все", () => {
    const names = proposedNames(
      wrap("- собственный тест границы — вместо Ruff, который проверяет слои; - переход на Runtime — вместо фабрики и замыканий."),
    );
    assert.equal(names.length, 2, `найдено ${names.length}: ${JSON.stringify(names)}`);
  });

  it("AB-13: пустой раздел честно даёт пусто, а не выдумку", () => {
    assert.deepEqual(proposedNames(wrap("предложений вместо готового нет.")), []);
  });

  it("AB-13: готовое не попадает в предложенное", () => {
    const names = proposedNames(
      wrap("RunContext — вместо langgraph.StateGraph и Runtime, которые передают зависимости."),
    );
    assert.ok(!names.includes("langgraph.StateGraph"), "механизм библиотеки принят за предложение");
    assert.ok(!names.includes("Runtime"), "готовый механизм принят за предложение");
  });

  it("AB-13: строка без слова «вместо» не считается случаем", () => {
    assert.deepEqual(proposedNames(wrap("Агент переписал два файла и прогнал тесты.")), []);
  });
});
