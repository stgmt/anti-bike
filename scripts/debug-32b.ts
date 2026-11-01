import { proposedNames } from "../src/judge.ts";
const s = "ВМЕСТО ГОТОВОГО\nпредложений вместо готового нет\n\nСОЗДАЛ НОВОЕ\nx";
console.log("32:", JSON.stringify(proposedNames(s)));
const s10 = "ВМЕСТО ГОТОВОГО — главное.\nпредложений вместо готового нет.\n\nСОЗДАЛ НОВОЕ\nx";
console.log("10б:", JSON.stringify(proposedNames(s10)));
console.log("regex:", /вместо готового\s+нет/i.test("предложений вместо готового нет"));
