/**
 * Повтор временных отказов (AB-10).
 *
 * Замер прогона detect2: 2 окна из 150 потеряны на HTTP 429 «Model busy»,
 * 9 — на пустой сводке при низком потолке. Окно — это час работы агента,
 * терять его из-за занятости модели нельзя.
 *
 * Правило проверяем по поведению, а не по списку слов: что повторилось,
 * что нет и с каким потолком ушёл повтор.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isTransient, retryTransient } from "../src/retry.ts";
import { MIN_MAX_TOKENS, RETRY_MAX_TOKENS } from "../src/summarize.ts";

describe("повтор отказов", () => {
  it("AB-10: занятость модели считается временным отказом", () => {
    assert.equal(isTransient(new Error("сводка ответила 429: Model busy")), true);
    assert.equal(isTransient(new Error("decisions ответил 502: bad gateway")), true);
    assert.equal(isTransient(new Error("socket ETIMEDOUT")), true);
  });

  it("AB-10: отказ по схеме и ключу не повторяется", () => {
    assert.equal(isTransient(new Error("400: invalid json_schema")), false);
    assert.equal(isTransient(new Error("401: unauthorized")), false);
    assert.equal(isTransient(new Error("в ответе нет answers.bike.noul")), false);
  });

  it("AB-10: временный отказ повторяется и вторая попытка проходит", async () => {
    let calls = 0;
    const value = await retryTransient(async () => {
      calls += 1;
      if (calls === 1) throw new Error("429 Model busy");
      return "ок";
    }, { delayMs: 1 });
    assert.equal(value, "ок");
    assert.equal(calls, 2, "окно потеряно на первом отказе");
  });

  it("AB-10: окончательный отказ пробрасывается, а не глотается", async () => {
    let calls = 0;
    await assert.rejects(
      retryTransient(async () => {
        calls += 1;
        throw new Error("401 unauthorized");
      }, { delayMs: 1 }),
      /401/,
    );
    assert.equal(calls, 1, "бессмысленный отказ повторяли");
  });

  it("AB-10: потолок повтора выше первого и больше минимального", () => {
    assert.ok(RETRY_MAX_TOKENS > MIN_MAX_TOKENS, "повтор не поднимает потолок");
    assert.ok(RETRY_MAX_TOKENS >= 12_000, `потолок повтора мал: ${RETRY_MAX_TOKENS}`);
  });
});
