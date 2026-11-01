/**
 * Ступень 1: отсев по тексту (AB-01).
 *
 * Тексты взяты из настоящей сессии. Каждый тест называет, какую поломку ловит.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectIntent } from "../src/intent.ts";

// Настоящий велосипед: опция вопроса, предложившая свой RunContext.
const BIKE = "Один срез: RunContext — ввести объект «окружение шага» "
  + "(prices/budget_limit/limits/max_output_tokens/clock) и провести через 16 узлов.";

// Настоящий отчёт без обещания.
const REPORT = "Независимое ревью нашло, что выделенная запись историй не упростила код: "
  + "она только перенесла тот же цикл с шестью аргументами. Верну цикл на место.";

// Исправленный ход: тот же RunContext, но со ссылкой на готовое.
const FIXED = "Штатный механизм: StateGraph(state_schema, context_schema=Context), "
  + "Runtime[Context] в узле подставляется сам. Перейду на него, свой объект не ввожу.";

describe("detectIntent", () => {
  it("AB-01: находит обещание нового объекта в настоящем велосипеде", () => {
    const intent = detectIntent(BIKE);
    assert.equal(intent.promise, true, "велосипед не опознан — гейт промолчит");
    assert.ok(intent.matches.length > 0);
  });

  it("AB-01: обычный отчёт без обещания новой сущности не пропускает дальше", () => {
    const intent = detectIntent(REPORT);
    assert.equal(intent.promise, false, "отчёт принят за велосипед — модель зовётся зря");
  });

  it("AB-01: отрицание «не ввожу» считается обещанием — ступень 1 решает модель", () => {
    // Ступень 1 нарочно грубая: она отсеивает, а не судит. Пусть отсечёт лишнее,
    // модель потом ответит «нет». Обратное поведение опаснее: пропустит велосипед.
    assert.equal(detectIntent(FIXED).promise, true);
  });

  it("AB-01: глагол и существительное в разных предложениях не дают совпадения", () => {
    const text = "Сделал правку. Модуль уже есть в проекте, я его не трогал.";
    assert.equal(detectIntent(text).promise, false, "пара через всё сообщение — ложное срабатывание");
  });

  it("AB-01: пустой текст — нет обещания", () => {
    assert.equal(detectIntent("").promise, false);
    assert.equal(detectIntent("   \n  ").promise, false);
  });

  it("AB-01: законная новая работа тоже проходит отсев и уходит в модель", () => {
    const text = "Сделаю хук ~/.claude/hooks/anti-bike-stop.mjs: получает событие Stop и пишет замеры.";
    // Ступень 1 не различает законное и велосипед — это работа ступени 3.
    // Тест закрепляет, что и законное обещание не отсекается молча.
    assert.equal(detectIntent(text).promise, true);
  });
});
