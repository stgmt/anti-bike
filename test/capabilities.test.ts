/**
 * Список возможностей (AB-05).
 *
 * Замеры показали, что источник списка решает больше, чем модель: автосборка
 * даёт 0,022, курируемый файл — 0,951. Тесты закрепляют приоритет источника.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CAPABILITIES_PATH,
  MAX_CAPABILITIES,
  readCapabilities,
  resolveCapabilities,
} from "../src/capabilities.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = join(HERE, "fixtures", "bike-repo");

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "anti-bike-caps-"));
}

describe("список возможностей", () => {
  it("AB-05: курируемый файл проекта читается и содержит механизмы", async () => {
    const text = await readCapabilities(FIXTURE_REPO);
    assert.ok(text !== null, "файл проекта не прочитан");
    assert.ok(text.includes("context_schema"), "в списке нет механизма, ради которого он нужен");
  });

  it("AB-05: курируемый список главнее автосписка", async () => {
    const resolved = await resolveCapabilities(FIXTURE_REPO, async () => "АВТОСПИСОК");
    assert.equal(resolved.source, "file", "автосписок перебил курируемый");
    assert.ok(resolved.markdown.includes("context_schema"));
  });

  it("AB-05: без курируемого файла берётся автосписок, а не пустота", async () => {
    const repo = await tempRepo();
    try {
      const resolved = await resolveCapabilities(repo, async () => "АВТОСПИСОК");
      assert.equal(resolved.source, "auto");
      assert.equal(resolved.markdown, "АВТОСПИСОК");
    } finally {
      await rm(repo, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  });

  it("AB-05: пустой файл не считается списком", async () => {
    const repo = await tempRepo();
    try {
      await mkdir(join(repo, ".anti-bike"), { recursive: true });
      await writeFile(join(repo, CAPABILITIES_PATH), "   \n\n  ");
      const resolved = await resolveCapabilities(repo, async () => "АВТОСПИСОК");
      assert.equal(resolved.source, "auto", "пустой файл принят за список");
    } finally {
      await rm(repo, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  });

  it("AB-05: длинный список обрезается, а не уходит модели целиком", async () => {
    const repo = await tempRepo();
    try {
      await mkdir(join(repo, ".anti-bike"), { recursive: true });
      await writeFile(join(repo, CAPABILITIES_PATH), "х".repeat(MAX_CAPABILITIES * 2));
      const resolved = await resolveCapabilities(repo, async () => "");
      assert.equal(resolved.size, MAX_CAPABILITIES);
    } finally {
      await rm(repo, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  });
});
