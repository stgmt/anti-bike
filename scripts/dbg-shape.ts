import { JscpdMcp } from "../src/mcp.ts";
import { readFile } from "node:fs/promises";

const c = new JscpdMcp("E:/repos/anti-bike/test/fixtures/bike-repo/src");
await c.start();
const code = await readFile("E:/repos/anti-bike/test/fixtures/bike-repo/src/agent_wrote.py", "utf8");
const raw = (await c.request("tools/call", {
  name: "check_duplication",
  arguments: { code, format: "python", kinds: ["exact", "renamed", "similar"] },
})) as { content?: { text?: string }[] };
console.log(raw.content?.[0]?.text?.slice(0, 1500));
c.close();
process.exit(0);
