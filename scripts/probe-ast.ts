/**
 * Что именно находит проверка существования и с какой точностью.
 *
 * Прошлый замер по подстроке дал осечки: RunContext «нашёлся» в моём же
 * скрипте-пробе, StepContext — в чужом пакете .venv. Подстрока не отличает
 * объявление от упоминания. Здесь три уровня точности, все измерены:
 *
 *   подстрока  — быстро, ошибается на пробах и чужих пакетах;
 *   объявление — только строки class/def/type, по тем же файлам;
 *   AST        — настоящий разбор Python, имя объявления.
 *
 * Запуск: node --experimental-strip-types scripts/probe-ast.ts
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const REPO = "E:/repos/carousel-demo";
/** Только пакет проекта: пробы, прогоны и чужие пакеты сюда не входят. */
const PACKAGE = [REPO + "/carousel"];

const NAMES = [
  { name: "FigureVerdicts", expect: true },
  { name: "figure_places", expect: true },
  { name: "ReaderProfile", expect: true },
  { name: "load_reader", expect: true },
  { name: "RunContext", expect: false },
  { name: "ReaderExamples", expect: false },
];

function ms(started: number): string {
  return `${(performance.now() - started).toFixed(1)} мс`;
}

async function main(): Promise<void> {
  // Уровень 1: подстрока по пакету.
  let started = performance.now();
  const substring = new Map<string, string>();
  for (const { name } of NAMES) {
    let hit = "";
    try {
      const { stdout } = await run("rg", ["-l", "-F", name, ...PACKAGE]);
      hit = stdout.split("\n").filter(Boolean)[0] ?? "";
    } catch {
      hit = "";
    }
    if (hit) substring.set(name, hit.split(/[\\/]/).slice(-2).join("/"));
  }
  console.log(`подстрока (rg -F, только пакет carousel/): ${ms(started)}`);
  for (const { name, expect } of NAMES) {
    const where = substring.get(name);
    console.log(`  ${(where !== undefined) === expect ? "верно " : "ОШИБКА"} ${name.padEnd(16)} ${where ?? "не найден"}`);
  }

  // Уровень 2: только объявления, тем же rg, но с шаблоном объявления.
  started = performance.now();
  const declared = new Map<string, string>();
  for (const { name } of NAMES) {
    let hit = "";
    try {
      const { stdout } = await run("rg", [
        "-n", "-F",
        "-e", `class ${name}`, "-e", `def ${name}`, "-e", `${name} = `, "-e", `${name}: `,
        ...PACKAGE,
      ]);
      hit = stdout.split("\n").filter(Boolean)[0] ?? "";
    } catch {
      hit = "";
    }
    if (hit) declared.set(name, hit.split(":")[0].split(/[\\/]/).slice(-2).join("/"));
  }
  console.log(`\nобъявления (шаблон class/def/присваивание): ${ms(started)}`);
  for (const { name, expect } of NAMES) {
    const where = declared.get(name);
    console.log(`  ${(where !== undefined) === expect ? "верно " : "ОШИБКА"} ${name.padEnd(16)} ${where ?? "не найден"}`);
  }

  // Уровень 3: Python AST, настоящий разбор. Один процесс на репозиторий.
  started = performance.now();
  const script = `
import ast, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
names = set(json.loads(sys.argv[2]))
found = {}
for path in root.rglob("*.py"):
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="ignore"))
    except SyntaxError:
        continue
    for node in ast.walk(tree):
        name = None
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            name = node.name
        elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            name = node.target.id
        if name in names and name not in found:
            found[name] = str(path.relative_to(root))
            if len(found) == len(names):
                break
print(json.dumps(found))
`;
  let astFound: Record<string, string> = {};
  try {
    const { stdout } = await run("python", ["-c", script, REPO + "/carousel", JSON.stringify(NAMES.map((item) => item.name))], {
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    astFound = JSON.parse(stdout.trim()) as Record<string, string>;
  } catch (error) {
    console.log(`\nAST не отработал: ${String(error).slice(0, 120)}`);
  }
  console.log(`\nAST (настоящий разбор Python): ${ms(started)}`);
  for (const { name, expect } of NAMES) {
    const where = astFound[name];
    console.log(`  ${(where !== undefined) === expect ? "верно " : "ОШИБКА"} ${name.padEnd(16)} ${where ?? "не найден"}`);
  }
}

await main();
