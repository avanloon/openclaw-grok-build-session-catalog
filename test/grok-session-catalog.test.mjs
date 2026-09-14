import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const id = "019fba9a-2475-72f3-b624-3ab86cc20be5";

test("lists a Grok Build session and redacts its system prompt", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "grok-session-catalog-"));
  const session = path.join(home, "sessions", "workspace", id);
  const original = process.env.GROK_HOME;
  try {
    await mkdir(session, { recursive: true });
    await writeFile(
      path.join(session, "summary.json"),
      JSON.stringify({
        info: { id, cwd: "/tmp/shadowiq" },
        generated_title: "Audit trip alerts",
        updated_at: "2026-09-14T07:00:00.000Z",
      }),
    );
    await writeFile(
      path.join(session, "chat_history.jsonl"),
      [
        JSON.stringify({ type: "system", content: "secret system prompt" }),
        JSON.stringify({ type: "user", content: [{ type: "text", text: "Audit this trip" }] }),
        JSON.stringify({ type: "assistant", content: "Here is the result" }),
      ].join("\n"),
    );
    process.env.GROK_HOME = home;
    const catalog = await import("../dist/grok-session-catalog.js");
    const list = await catalog.listLocalGrokSessionPage({ limit: 10 });
    assert.equal(list.sessions[0].threadId, id);
    assert.equal(list.sessions[0].canContinue, false);
    const result = await catalog.readLocalGrokTranscriptPage({ threadId: id, limit: 10 });
    assert.deepEqual(result.items, [
      { type: "agentMessage", text: "Here is the result" },
      { type: "userMessage", text: "Audit this trip" },
    ]);
  } finally {
    if (original === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = original;
    await rm(home, { recursive: true, force: true });
  }
});
