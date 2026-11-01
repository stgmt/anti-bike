/** Полная сводка по окну tokenplan: что модель вообще назвала. */
import { readFileSync } from "node:fs";
import { summarize } from "../src/summarize.ts";

const KEY_FILE = "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";
const key = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"))![0];
const text = readFileSync("bench/case-tokenplan-effort-probe.txt", "utf8");
const s = await summarize(text, { apiKey: key });
console.log(`пусто=${s.empty} знаков=${s.outputChars}\n`);
console.log(s.text);
