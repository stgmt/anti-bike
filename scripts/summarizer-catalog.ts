/**
 * Кандидаты в самаризаторы из каталога OpenRouter.
 *
 * Критерии: дешёвый вход (транскрипт — это много входа и мало выхода), большой
 * контекст (ход бывает на десятки тысяч знаков), малая задержка.
 */

import { readFileSync } from "node:fs";

const KEY_FILE =
  "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";

function apiKey(): string {
  const text = readFileSync(KEY_FILE, "utf8");
  const match = /sk-or-v1-[A-Za-z0-9]+/.exec(text);
  if (!match) throw new Error("ключ не найден");
  return match[0];
}

interface Model {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  architecture: { input_modalities: string[]; output_modalities: string[] };
}

async function main(): Promise<void> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  const payload = (await response.json()) as { data: Model[] };
  const models = payload.data.filter(
    (model) =>
      model.architecture?.output_modalities?.includes("text") &&
      model.architecture?.input_modalities?.includes("text"),
  );

  // Транскрипт — это вход. Считаем цену за 20 тыс. токенов входа и 500 выхода.
  const scored = models
    .map((model) => {
      const prompt = Number(model.pricing.prompt) * 1_000_000;
      const completion = Number(model.pricing.completion) * 1_000_000;
      if (!Number.isFinite(prompt) || prompt < 0) return null;
      if (!Number.isFinite(completion) || completion < 0) return null;
      const cost = (prompt * 20_000 + completion * 500) / 1_000_000;
      return { id: model.id, prompt, completion, context: model.context_length, cost };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .filter((row) => row.context >= 100_000)
    .sort((left, right) => left.cost - right.cost);

  console.log("Дешёвые модели с контекстом ≥100k, цена за ход 20k входа + 500 выхода");
  console.log("=".repeat(78));
  console.log(`${"модель".padEnd(46)} ${"вход/1M".padStart(9)} ${"выход/1M".padStart(10)} ${"ход$".padStart(9)}`);
  for (const row of scored.slice(0, 30)) {
    console.log(
      `${row.id.padEnd(46)} ${row.prompt.toFixed(3).padStart(9)} `
      + `${row.completion.toFixed(3).padStart(10)} ${row.cost.toFixed(5).padStart(9)}`,
    );
  }
  console.log(`\nвсего моделей с текстовым входом и выходом: ${models.length}`);
}

await main();
