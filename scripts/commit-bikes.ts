/**
 * Что коммит написал заново, хотя это уже лежало в репозитории.
 *
 * Вход — репозиторий и коммит. Контекст берётся сам: добавленное из дифа,
 * готовое из дерева родителя. Списка пар на входе нет.
 *
 * Запуск:
 *   node --experimental-strip-types scripts/commit-bikes.ts <репо> [коммит] [--all] [--min N]
 *
 * `--all` включает копии внутри тела функции: у них реюз дороже (нужен вынос),
 * по умолчанию они не выходят.
 */
import { copiesInCommit } from "../src/commit.ts";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flag = (name: string): boolean => args.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const repo = positional[0];
const commit = positional[1] ?? "HEAD";
if (repo === undefined) {
  console.error("нужен путь к репозиторию: commit-bikes.ts <репо> [коммит]");
  process.exit(2);
}

const started = Date.now();
const copies = copiesInCommit(repo, commit, {
  includeInFunction: flag("all"),
  ...(value("min") !== undefined ? { minLength: Number(value("min")) } : {}),
});
const ms = Date.now() - started;

if (copies.length === 0) {
  console.log(`копий нет (${ms} мс)`);
  process.exit(0);
}

console.log(`копий: ${copies.length} (${ms} мс)`);
for (const c of copies) {
  console.log(`  ${c.added.file}:${c.added.start}  [${c.added.name}]`);
  console.log(`    уже было: ${c.ready.file}:${c.ready.start}  [${c.ready.name}]`);
}
