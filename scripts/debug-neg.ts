import { proposedNames } from "../src/judge.ts";
const CASES = [
  "ВМЕСТО ГОТОВОГО — главное\nпредложений вместо готового нет.\n\nСОЗДАЛ НОВОЕ\nx",
  "ВМЕСТО ГОТОВОГО\nпредложений вместо готового нет\n\nСОЗДАЛ НОВОЕ\nx",
  "ВМЕСТО ГОТОВОГО — главное.\nпредложений вместо готового нет.\n\nСОЗДАЛ НОВОЕ\nx",
];
CASES.forEach((s, i) => console.log(i, JSON.stringify(proposedNames(s))));
console.log("regex test:", /вместо готов\w*\s+нет/i.test("предложений вместо готового нет."));
