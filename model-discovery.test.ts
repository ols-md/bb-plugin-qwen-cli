import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { chatIds, discover, prepareModelOverlay } from "./model-discovery.ts";

const base = "https://token-plan.maas.qwencloudapi.com/compatible-mode/v1";
test("catalog validation, filtering, exact IDs and deduplication", () => {
  assert.deepEqual(chatIds({ data: ["bad", ...["qwen4-max-preview", "qwen4-max-preview", "future-chat-2030", "wan3.0-video", "qwen-audio-tts", "auto", "bad/id"].map(id => ({ id }))] }), ["qwen4-max-preview", "future-chat-2030"]);
  assert.throws(() => chatIds({}));
});
test("trusted endpoint, cache and bounded failure fallback", async () => {
  let calls = 0;
  const fetcher = (async (_url: any, options: any) => {
    calls++; assert.equal(options.redirect, "error"); assert.ok(options.signal);
    return new Response(JSON.stringify({ data: [{ id: "future-chat" }] }));
  }) as typeof fetch;
  assert.deepEqual(await discover("https://attacker.invalid", "secret", fetcher), []);
  assert.equal(calls, 0);
  assert.deepEqual(await discover(base, "test-cache", fetcher), ["future-chat"]);
  await discover(base, "test-cache", fetcher); assert.equal(calls, 1);
  const now = Date.now;
  try {
    Date.now = () => now() + 6 * 60_000;
    assert.deepEqual(await discover(base, "test-cache", (async () => { throw new Error("offline"); }) as typeof fetch), ["future-chat"]);
  } finally { Date.now = now; }
  for (const [key, response] of [["401", new Response("", { status: 401 })], ["malformed", new Response("{}")], ["large", new Response("x".repeat(512001))]] as const) {
    assert.deepEqual(await discover(base, key, (async () => response) as typeof fetch), []);
  }
});
test("both launch shapes merge policy and custom metadata without storing credentials; workspace fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "qwen-test-"));
  const originalFetch = globalThis.fetch;
  try {
    const home = join(root, "home"); await mkdir(home);
    const system = join(root, "system.json");
    await writeFile(system, JSON.stringify({ security: { auth: { enforcedType: "openai" } } }));
    await writeFile(join(home, "settings.json"), JSON.stringify({ env: { TEST_PLAN_KEY: "never-serialize-this" }, modelProviders: { openai: [
      { id: "old", baseUrl: base, envKey: "TEST_PLAN_KEY", contextWindowSize: 123 },
      { id: "custom", baseUrl: "https://custom.invalid", envKey: "CUSTOM" },
    ] } }));
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [{ id: "qwen4-max-preview" }, { id: "future-new-chat" }] }))) as typeof fetch;
    const po = { acpLaunchSpec: { command: process.execPath, args: ["-e", "process.stdin.pipe(process.stdout)"], env: { QWEN_HOME: home, QWEN_CODE_SYSTEM_SETTINGS_PATH: system } } };
    for (const request of [
      { method: "provider/models", params: { cwd: root, providerOptions: po } },
      { method: "model/list", params: { cwd: root, providerOptions: po } },
      { method: "thread/start", params: { cwd: root, options: { providerOptions: po } } },
    ]) {
      const result = await prepareModelOverlay(request);
      const options = result.params.providerOptions ?? result.params.options.providerOptions;
      const text = await readFile(options.acpLaunchSpec.env.QWEN_CODE_SYSTEM_SETTINGS_PATH, "utf8");
      assert.ok(!text.includes("never-serialize-this"));
      const overlay = JSON.parse(text);
      assert.equal(overlay.security.auth.enforcedType, "openai");
      assert.equal(overlay.modelProviders.openai[0].contextWindowSize, 123);
      assert.equal(overlay.modelProviders.openai[1].baseUrl, "https://custom.invalid");
      assert.ok(overlay.modelProviders.openai.some((m: any) => m.id === "future-new-chat"));
      const legacy = spawnSync(options.acpLaunchSpec.command, options.acpLaunchSpec.args, {
        input: JSON.stringify({ method: "session/set_model", params: { modelId: "exact-route", _meta: { existing: true } } }) + "\n",
        encoding: "utf8", timeout: 5000,
      });
      assert.equal(legacy.status, 0, legacy.stderr);
      const forwarded = JSON.parse(legacy.stdout);
      assert.equal(forwarded.params.modelId, "exact-route");
      assert.equal(forwarded.params._meta.existing, true);
      assert.equal(forwarded.params._meta["qwen.session.modelPersistDefault"], false);
    }
    await mkdir(join(root, ".qwen"));
    await writeFile(join(root, ".qwen", "settings.json"), '{"modelProviders":{"openai":[]}}');
    const request = { method: "provider/models", params: { cwd: root, providerOptions: po } };
    assert.equal(await prepareModelOverlay(request), request);
    await rm(join(root, ".qwen"), { recursive: true });
    await writeFile(system, '{"env":{"SYSTEM_POLICY":"preserve-precedence"}}');
    assert.equal(await prepareModelOverlay(request), request);
    assert.equal(process.env.QWEN_CODE_SYSTEM_SETTINGS_PATH, undefined);
  } finally { globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); }
});
