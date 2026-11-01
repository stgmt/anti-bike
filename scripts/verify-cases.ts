/**
 * Проверка машинного признака на подтверждённых случаях.
 *
 * Грунт истины: претензии владельца. Признак опознаёт велосипед, если окно
 * написало своё по тому же предмету, что и непозванное готовое.
 */
import { verifyWindow } from "./verify-window.ts";

const CASES: [string, string, string, string][] = [
  ["tokenplan effort probe", "C:/Users/stigm/.claude/projects/E--repos-tokenplan/4a524b84-b325-4bc7-b07c-de9d61182593.jsonl", "E:/repos/agent-teams-ai", "bike"],
  ["carousel RunContext", "C:/Users/stigm/.claude/projects/E--repos-carousel-demo/e14220d8-2553-45ea-ac25-df1debcb7d14.jsonl", "E:/repos/carousel-demo", "bike"],
];

for (const [label, file, repo, expected] of CASES) {
  const v = await verifyWindow(file, repo);
  const ok = v.verdict === expected ? "ВЕРНО" : "ПРОМАХ";
  console.log(`\n${label}: ${ok}  (${v.verdict})`);
  console.log(`  ${v.why}`);
  console.log(`  объявлено ${v.declared}, своё ${v.own.length}, готовое позвано ${v.readyCalled.length}, не позвано по предмету ${v.readyByTopic.length}`);
}
