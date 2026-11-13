import { test } from "node:test";
import assert from "node:assert/strict";
import { registerQwenAcpDialect } from "./dialect.ts";

test("registered classifier supplies SDK item shapes for every classified tool", () => {
  const dialect = registerQwenAcpDialect();
  for (const name of ["run_command", "read_file", "view_file", "view_file_outline", "view_code_item", "write_file", "edit", "grep_search", "glob", "list_dir", "list_resources", "web_fetch", "read_url_content", "web_search", "search_web", "invoke_subagent", "define_subagent", "manage_subagents", "send_message", "manage_task", "schedule"]) {
    for (const sessionUpdate of ["tool_call", "tool_call_update"] as const) {
      const classified = dialect.classifyToolCall!({ sessionUpdate, toolCallId: "call", name, rawInput: {} });
      assert.ok(classified, name);
      // The SDK translator dereferences item.type without a fallback.
      assert.equal(typeof classified.item.type, "string", name);
      assert.ok(classified.presentation.label.pending, name);
      assert.ok(classified.presentation.icon.glyph, name);
    }
  }
  assert.equal(dialect.classifyToolCall!({ sessionUpdate: "tool_call", toolCallId: "unknown", name: "unknown" }), undefined);
});

test("registered classifier retains rich rendering and presentation", () => {
  const dialect = registerQwenAcpDialect();
  const classify = (name: string, rawInput: Record<string, unknown>) => dialect.classifyToolCall!({
    sessionUpdate: "tool_call", toolCallId: "rich-call", name, rawInput,
  })!;
  const read = classify("read_file", { file_path: "src/main.ts" });
  assert.deepEqual(read.item, { type: "fileRead", path: "src/main.ts" });
  assert.equal(read.presentation.title, "Read src/main.ts");
  assert.equal(read.presentation.icon.glyph, "FileText");
  assert.deepEqual(classify("grep_search", { pattern: "needle" }).item, { type: "search", query: "needle", mode: "content" });
  assert.deepEqual(classify("glob", { pattern: "*.ts" }).item, { type: "search", query: "*.ts", mode: "path" });
  assert.deepEqual(classify("web_search", { query: "SDK" }).item, { type: "webSearch", queries: ["SDK"] });
  assert.deepEqual(classify("web_fetch", { url: "https://example.com" }).item, { type: "webFetch", url: "https://example.com", pattern: null });
  const command = classify("run_command", { command: "npm test", description: "Run tests" });
  assert.deepEqual(command.item, { type: "command", command: "npm test", cwd: "" });
  assert.equal(command.presentation.title, "Run tests");
  assert.equal(command.presentation.detail, "npm test");
  const delegation = classify("invoke_subagent", { Role: "Reviewer", Prompt: "Review code" });
  assert.deepEqual(delegation.item, { type: "delegation", childRef: "rich-call", label: "Reviewer", summary: "Review code", background: true });
  assert.equal(delegation.presentation.icon.glyph, "Bot");
  const generic = dialect.classifyToolCall!({ sessionUpdate: "tool_call_update", toolCallId: "tool", name: "manage_task",
    status: "failed", rawInput: { Action: "status", TaskId: "task" }, rawOutput: { error: "failed" },
  })!;
  assert.deepEqual(generic.item, { type: "tool", tool: "manage_task", args: { Action: "status", TaskId: "task" }, result: { error: "failed" } });
  for (const name of ["write_file", "edit"]) {
    const diff = dialect.classifyToolCall!({ sessionUpdate: "tool_call_update", toolCallId: "diff", name,
      content: [{ type: "diff", path: "new.ts", oldText: null, newText: "new" },
        { type: "diff", path: "existing.ts", oldText: "old", newText: "updated" }],
    })!;
    assert.deepEqual(diff.item, { type: "fileChange", changes: [
      { path: "new.ts", kind: "add", newText: "new" },
      { path: "existing.ts", kind: "update", oldText: "old", newText: "updated" },
    ] });
    assert.equal(diff.presentation.icon.glyph, name === "edit" ? "FileEdit" : "FilePlus");
  }
});
