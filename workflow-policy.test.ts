import { test } from "node:test";
import assert from "node:assert/strict";
import { enforceWorkflowPolicy, filterWorkflowOptions } from "./workflow-policy.ts";

test("native workflows stay disabled for discovery, new threads, resumes and turns", () => {
  for (const method of ["provider/models", "model/list", "thread/start", "thread/resume", "turn/start"]) {
    const providerOptions = { acpLaunchSpec: { env: { QWEN_CODE_ENABLE_WORKFLOWS: "1", QWEN_CODE_DISABLE_WORKFLOWS: "0", KEEP: "yes" } } };
    const options = { providerOptions, sessionOptions: { workflow_mode: "on", mode: "plan" } };
    const request = { method, params: { options, providerOptions } };
    enforceWorkflowPolicy(request);
    assert.deepEqual(options.sessionOptions, { mode: "plan" });
    assert.deepEqual(providerOptions.acpLaunchSpec.env, {
      QWEN_CODE_ENABLE_WORKFLOWS: "1", QWEN_CODE_DISABLE_WORKFLOWS: "1", KEEP: "yes",
    });
  }
  enforceWorkflowPolicy({ method: "thread/start", params: {} });
});

test("workflow control is removed from model discovery and live session updates", () => {
  const options = [{ id: "workflow_mode", value: "on" }, { id: "mode", value: "plan" }];
  const session = { kind: "extension.state", extensionKind: "bb/session-options", payload: { options } };
  const unrelated = { kind: "extension.state", extensionKind: "other", payload: { options } };
  const message = { result: { models: [{ id: "qwen", sessionOptions: options }], sessionOptions: options }, params: { deltas: [session, unrelated] } };
  filterWorkflowOptions(message);
  assert.deepEqual(message.result.models[0].sessionOptions, [options[1]]);
  assert.deepEqual(message.result.sessionOptions, [options[1]]);
  assert.deepEqual(session.payload.options, [options[1]]);
  assert.deepEqual(unrelated.payload.options, options);
  filterWorkflowOptions({ result: {} });
});
