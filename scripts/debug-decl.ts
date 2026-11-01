import { declarationsIn } from "../src/astgraph.ts";
const sample = `src/renderer/utils/x.ts:10:export function resolveAnthropicEffortSupport(params: {\nsrc/renderer/utils/x.ts:20:export const normalizeEffortLevels = (v) => v;\n`;
console.log("с :\n:", declarationsIn(sample, "t").map(d => d.name));
const sample2 = `export function resolveAnthropicEffortSupport(params: {`;
console.log("без:", declarationsIn(sample2, "t").map(d => d.name));
