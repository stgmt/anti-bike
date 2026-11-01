import { readFileSync, writeFileSync } from "node:fs";
import { summarize } from "../src/summarize.ts";
const KEY_FILE = "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";
const key = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"))![0];
const s = await summarize(readFileSync("bench/case-tokenplan-effort-probe.txt", "utf8"), { apiKey: key });
writeFileSync("bench/summary-tokenplan.txt", s.text, "utf8");
console.log(`сохранено ${s.outputChars} знаков`);
