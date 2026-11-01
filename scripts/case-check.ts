/**
 * Проверка второго случая тем же путём, что и гейт.
 *
 * Окно tokenplan, где агент построил свой probe вместо штатной проверки.
 * Их трое имён в коде репо нет — значит проверка существования их не снимет.
 *
 * Запуск: node --experimental-strip-types scripts/case-check.ts [имя-случая]
 */

import { readFileSync } from "node:fs";

import { judgeWindow, proposedNames } from "../src/judge.ts";

const KEY_FILE =
  "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";

const READY_TOKENPLAN = `Что уже есть в проекте tokenplan и его библиотеках:

- Electron + electron-vite + React; TypeScript; zustand для состояния; vitest для тестов;
  playwright для e2e.
- Провайдеры моделей: собственный слой провайдеров с каталогом моделей, статусом провайдера и
  проверкой доступности модели. Каталог моделей отдаёт список моделей и их параметры (в том
  числе effort). Статус провайдера приходит от провайдера и считается подтверждённым, если
  провайдер его прислал.
- Запуск команды проходит через слой provisioning: preflight-проверки, права запуска, guard на
  запуск команды (createLaunchGuard, launchAuthorityBlockers).
- В репозитории уже есть: services/team/provisioning с preflight-провайдером; компонент
  выбора модели команды (TeamModelSelector) с resolveTeamModelSelectorValue; диагностика
  подготовки провайдера (providerPrepareDiagnostics).`;

function apiKey(): string {
  const match = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"));
  if (!match) throw new Error("ключ не найден");
  return match[0];
}

async function main(): Promise<void> {
  const name = process.argv[2] ?? "case-tokenplan-effort-probe";
  const windowText = readFileSync(`bench/${name}.txt`, "utf8");
  console.log(`случай ${name}: ${windowText.length} знаков\n`);

  for (let run = 1; run <= 3; run += 1) {
    const started = Date.now();
    const result = await judgeWindow(windowText, {
      apiKey: apiKey(),
      roots: ["E:/repos/tokenplan/src"],
      ready: READY_TOKENPLAN,
    });
    const names = result.summary ? proposedNames(result.summary.text) : [];
    console.log(
      `прогон ${run}: ${result.kind.toUpperCase()}  оценка ${result.verdict?.score?.toFixed(3) ?? "—"}  `
      + `${Date.now() - started} мс`,
    );
    console.log(`  названо вместо готового: ${names.join(", ") || "—"}`);
    console.log(`  нет в коде репо: ${result.absent.join(", ") || "—"}`);
    console.log(`  уже есть в репо: ${result.exists.map((item) => `${item.name}@${item.where}`).join(", ") || "—"}`);
    console.log(`  причина: ${result.reason}`);
    if (run === 1 && result.summary) {
      const head = result.summary.text.split("СОЗДАЛ НОВОЕ")[0].trim();
      console.log(`  сводка:\n${head.split("\n").slice(0, 5).map((line) => `    ${line}`).join("\n")}`);
    }
    console.log();
  }
}

await main();
