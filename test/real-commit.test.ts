/**
 * AB-24: детектор на настоящем коммите настоящего репозитория.
 *
 * Все прочие тесты построены на фикстурах, а фикстуру пишу я — значит она
 * подтверждает моё же понимание задачи. Здесь данных я не касаюсь: берётся
 * коммит из `agts-merge`, где копия появилась на самом деле, и проверяется
 * только то, что детектор её находит.
 *
 * Коммит `a008adf7b` (2026-11-02, «Build the provider ports once for preparation
 * and launch») добавил файл `createNativeProvisioningSupport.ts`, а в нём —
 * блок `workSync`, дословно повторяющий блок из `createNativeProviderPorts.ts`,
 * который лежал в репозитории с 30 октября.
 *
 * Репозиторий внешний: если его нет на машине, тест пропускается, а не падает.
 * Пропуск помечен причиной, чтобы «зелёное» не выдавалось за проверенное.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";

import { copiesInCommit } from "../src/commit.ts";

const REPO = "E:/repos/agts-merge";
const COMMIT = "a008adf7bca2d955418e99ad6ee632778911d285";
/**
 * Второй коммит, где копия уже внутри тела фабрики. Сначала детектор её не
 * находил: однострочная стрелка `laneKey` выше по файлу отдавала телом блок
 * следующей функции, и границы куска съезжали. Границы правятся в
 * `regionsIn`, а этот коммит сторожит, чтобы промах не вернулся.
 */
const COMMIT_NESTED = "da15ad931";

describe("AB-24: настоящий коммит", () => {
  it("AB-24: копия блока workSync из коммита a008adf7b находится в родителе", (t) => {
    if (!existsSync(`${REPO}/.git`)) {
      t.skip(`нет репозитория ${REPO}`);
      return;
    }

    const copies = copiesInCommit(REPO, COMMIT, { minLength: 80 });

    const found = copies.find(
      (c) =>
        c.added.file.endsWith("createNativeProvisioningSupport.ts") &&
        c.added.name === "workSync" &&
        c.ready.file.endsWith("createNativeProviderPorts.ts"),
    );
    assert.ok(found, `копия workSync не найдена; найдено: ${copies.map((c) => c.added.name).join(", ")}`);

    // Готовое обязано лежать в родителе коммита, а не в нём самом.
    assert.notEqual(found.ready.file, found.added.file);
    assert.ok(found.ready.start > 0);
  });

  it("AB-24: копия readActiveRuntimeLaneIds из коммита da15ad931 находится", (t) => {
    if (!existsSync(`${REPO}/.git`)) {
      t.skip(`нет репозитория ${REPO}`);
      return;
    }

    // Копия лежит в объекте-аргументе вызова, поэтому нужен includeInFunction:
    // по умолчанию такие копии не считаются находкой.
    const copies = copiesInCommit(REPO, COMMIT_NESTED, { minLength: 80, includeInFunction: true });

    const found = copies.find(
      (c) =>
        c.added.file.endsWith("createNativeOpenCodeDeliveryStack.ts") &&
        c.added.name === "readActiveRuntimeLaneIds" &&
        c.ready.file.endsWith("createNativeOpenCodeDeliveryWatchdog.ts"),
    );
    assert.ok(found, `копия не найдена; найдено: ${copies.map((c) => c.added.name).join(", ")}`);
  });
});
