/** Паспорта кандидатов: назначение, контекст, цена, поддерживаемые параметры. */

import { readFileSync } from "node:fs";

const KEY_FILE =
  "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";

function apiKey(): string {
  return /sk-or-v1-[A-Za-z0-9]+/
    .exec(readFileSync(KEY_FILE, "utf8"))![0];
}

interface Model {
  id: string;
  name: string;
  description?: string;
  context_length: number;
  pricing: Record<string, string>;
  supported_parameters?: string[];
  architecture?: Record<string, unknown>;
}

async function main(): Promise<void> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  const all = ((await response.json()) as { data: Model[] }).data;

  // Всё, что в названии или описании заявляет суммаризацию.
  const byName = all.filter((model) => /summar/i.test(model.id + " " + (model.description ?? "")));
  console.log(`Моделей с «summar» в имени или описании: ${byName.length}\n`);

  const wanted = [
    ...byName,
    ...all.filter((model) =>
      ["openai/gpt-oss-120b", "inclusionai/ling-3.0-flash", "mistralai/mistral-nemo",
       "qwen/qwen3.7-flash", "inference-net/schematron-v2-turbo", "openai/gpt-5-nano"].includes(model.id)),
  ];

  for (const model of wanted) {
    console.log("=".repeat(70));
    console.log(model.id);
    console.log(`  контекст: ${model.context_length}`);
    console.log(`  цена: вход ${model.pricing.prompt} выход ${model.pricing.completion}`);
    console.log(`  параметры: ${(model.supported_parameters ?? []).join(", ") || "(нет)"}`);
    console.log(`  описание: ${(model.description ?? "").replace(/\s+/g, " ").slice(0, 400)}`);
  }
}

await main();
