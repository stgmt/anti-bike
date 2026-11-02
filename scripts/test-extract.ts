/**
 * Проверка разбора тел: короткие формы, которые легко разъехаться.
 */
import { functionsIn } from "../src/bodies.ts";

const CASES: { label: string; code: string }[] = [
  {
    label: "стрелочная в одну строку без скобок",
    // Тело должно быть длиннее порога 60 знаков, иначе отсев по объёму.
    code: "const normalize = (text) => String(text).replace(/\\r\\n/g, '\\n').trim().toLowerCase();\n\nexport function hookBodyDigest(text) {\n  const lines = normalize(text).split('\\n');\n  return lines;\n}\n",
  },
  {
    label: "стрелочная с блоком",
    code: "const f = (a) => {\n  if (a) { return 1; }\n  return 2;\n};\n",
  },
  {
    label: "питон по отступам",
    code: "def outer(x):\n    total = 0\n    for i in range(x):\n        total += i\n    return total\n\ndef other(y):\n    return y\n",
  },
  {
    label: "класс",
    code: "export class Queue {\n  private tails = new Map();\n  run(k, task) {\n    return this.tails.get(k) ?? task();\n  }\n}\n",
  },
];

for (const c of CASES) {
  const fns = functionsIn(c.code, "x.ts");
  console.log(`\n${c.label}:`);
  for (const f of fns) console.log(`  ${f.name}: ${JSON.stringify(f.body.slice(0, 80))}`);
}
