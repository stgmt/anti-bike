import { declaredKind, nameIn } from "../src/exists.ts";
const line = "class Storyboard(Contract):";
console.log("nameIn:", nameIn(line));
console.log("declaredKind:", declaredKind(line, ["FigureVerdicts","RunContext","Storyboard","CardSpec"]));
