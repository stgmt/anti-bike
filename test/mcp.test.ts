/**
 * Ступень 2 через MCP (AB-02, AB-03, AB-04, AB-11).
 *
 * Проверяется на настоящем jscpd и настоящей фикстуре: поддельный ответ
 * не доказывает, что гейт увидит настоящий велосипед.
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { JscpdMcp } from "../src/mcp.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "bike-repo", "src");

const client = new JscpdMcp(FIXTURE);

after(() => client.close());

async function read(name: string): Promise<string> {
  return readFile(join(FIXTURE, name), "utf8");
}

describe("jscpd через MCP", () => {
  it("AB-02: находит велосипед, написанный другими именами", async () => {
    await client.start();
    const answer = await client.check(await read("agent_wrote.py"), "python");
    assert.ok(answer.count >= 1, "настоящий велосипед не найден");
    const files = answer.duplications.map((row) => row.file);
    assert.ok(
      files.includes("existing.py"),
      `адрес не указывает на существующий код: ${files.join(", ")}`,
    );
  });

  it("AB-02: адрес содержит файл и строку", async () => {
    await client.start();
    const answer = await client.check(await read("agent_wrote.py"), "python");
    const [first] = answer.duplications;
    assert.ok(first.file.length > 0, "нет файла — адрес бесполезен");
    assert.ok(first.fileStartLine > 0, "нет номера строки — агент не найдёт, что взять");
  });

  it("AB-03: законная новая работа не находит совпадений", async () => {
    await client.start();
    const answer = await client.check(await read("legit.py"), "python");
    const onExisting = answer.duplications.filter((row) => row.file.includes("existing.py"));
    assert.deepEqual(onExisting, [], "гейт нашёл велосипед там, где его нет");
  });

  it("AB-04: повторная проверка того же кода даёт тот же ответ", async () => {
    await client.start();
    const first = await client.check(await read("agent_wrote.py"), "python");
    const second = await client.check(await read("agent_wrote.py"), "python");
    assert.equal(first.count, second.count, "ответ зависит от прогрева — на него нельзя опереться");
  });

  it("AB-10: несуществующий путь даёт ошибку с таймаутом, а не вечное ожидание", async () => {
    // Замерено: на несуществующем пути jscpd не отвечает на initialize и не выходит.
    // Без таймаута хук зависает насмерть.
    const empty = new JscpdMcp(join(HERE, "нет-такого-пути"));
    try {
      await assert.rejects(
        () => empty.start(2_000),
        /не ответил за 2000 мс/,
        "клиент ждал ответа вечно — хук повесит агента",
      );
    } finally {
      empty.close();
    }
  });
});

describe("фикстура не меняется от проверки", () => {
  it("AB-11: после скана в папке те же три файла", async () => {
    await client.start();
    await client.check(await read("agent_wrote.py"), "python");
    const files = (await readdir(FIXTURE)).filter((name) => name.endsWith(".py")).sort();
    assert.deepEqual(files, ["agent_wrote.py", "existing.py", "legit.py"]);
  });
});
