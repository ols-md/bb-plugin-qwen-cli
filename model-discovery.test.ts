import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { chatIds, discover, prepareModelOverlay, nodeRunner } from "./model-discovery.ts";

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
      assert.equal(options.acpLaunchSpec.env.TEST_PLAN_KEY, "never-serialize-this");
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
    // Non-Token-Plan workspace modelProviders: discovery proceeds (harmless override)
    await writeFile(join(root, ".qwen", "settings.json"), '{"modelProviders":{"openai":[{"id":"local","baseUrl":"https://custom.invalid"}]}}');
    const request = { method: "provider/models", params: { cwd: root, providerOptions: po } };
    const overlayAfterWs = await prepareModelOverlay(request);
    assert.notEqual(overlayAfterWs, request, "discovery should proceed when workspace has no Token Plan routes");
    assert.ok(overlayAfterWs.params.providerOptions.acpLaunchSpec.env.QWEN_CODE_SYSTEM_SETTINGS_PATH);
    await rm(join(root, ".qwen"), { recursive: true });
    // Workspace with Token Plan route: discovery defers to workspace
    await mkdir(join(root, ".qwen"));
    await writeFile(join(root, ".qwen", "settings.json"), JSON.stringify({ modelProviders: { openai: [{ baseUrl: base }] } }));
    const published = process.env.QWEN_CODE_SYSTEM_SETTINGS_PATH;
    assert.ok(published && published.includes("bb-qwen-models-"), "success path publishes the overlay env to the worker");
    assert.equal(await prepareModelOverlay(request), request);
    await writeFile(system, '{"env":{"SYSTEM_POLICY":"preserve-precedence"}}');
    assert.equal(await prepareModelOverlay(request), request);
    assert.equal(process.env.QWEN_CODE_SYSTEM_SETTINGS_PATH, published, "bail paths must not republish the overlay env");
  } finally {
    delete process.env.QWEN_CODE_SYSTEM_SETTINGS_PATH;
    delete process.env.QWEN_CODE_SYSTEM_DEFAULTS_PATH;
    delete process.env.TEST_PLAN_KEY;
    globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); }
});


test("requested model survives a cold catalog; proxy bakes overlay env fallbacks", async () => {
  const root = await mkdtemp(join(tmpdir(), "qwen-inject-"));
  const originalFetch = globalThis.fetch;
  try {
    const home = join(root, "home"); await mkdir(home);
    const system = join(root, "system.json"); await writeFile(system, "{}");
    await writeFile(join(home, "settings.json"), JSON.stringify({
      env: { INJ_KEY: "inject-secret" },
      modelProviders: { openai: [{ id: "configured", baseUrl: base, envKey: "INJ_KEY" }] },
    }));
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [] }))) as typeof fetch;
    const request = { method: "thread/start", params: { cwd: root, options: { model: "future-new-chat(openai)", providerOptions: {
      acpLaunchSpec: { command: process.execPath, args: ["-e", ""], env: { QWEN_HOME: home, QWEN_CODE_SYSTEM_SETTINGS_PATH: system } },
    } } } };
    const result = await prepareModelOverlay(request);
    const spec = result.params.options.providerOptions.acpLaunchSpec;
    const overlay = JSON.parse(await readFile(spec.env.QWEN_CODE_SYSTEM_SETTINGS_PATH, "utf8"));
    assert.ok(overlay.modelProviders.openai.some((m: any) => m.id === "future-new-chat"), "requested model is injected when the catalog is cold");
    const proxy = await readFile(spec.args[0], "utf8");
    assert.ok(proxy.includes("QWEN_CODE_SYSTEM_SETTINGS_PATH="), "proxy bakes the overlay path as env fallback");
    assert.ok(!proxy.includes("inject-secret"), "proxy carries no secrets");
    assert.equal(nodeRunner(), process.execPath, "non-electron workers keep process.execPath");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.QWEN_CODE_SYSTEM_SETTINGS_PATH;
    delete process.env.QWEN_CODE_SYSTEM_DEFAULTS_PATH;
    delete process.env.INJ_KEY;
    await rm(root, { recursive: true, force: true });
  }
});

test("electron host worker keeps ELECTRON_RUN_AS_NODE and forwards user env keys to the overlay child", async () => {
  const root = await mkdtemp(join(tmpdir(), "qwen-electron-test-"));
  const originalFetch = globalThis.fetch;
  const original = process.env.ELECTRON_RUN_AS_NODE;
  try {
    const home = join(root, "home"); await mkdir(home);
    const system = join(root, "system.json"); await writeFile(system, "{}");
    await writeFile(join(home, "settings.json"), JSON.stringify({
      env: { TEST_KEY: "forwarded" },
      modelProviders: { openai: [{ id: "any", baseUrl: base, envKey: "TEST_KEY" }] },
    }));
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [] }))) as typeof fetch;
    process.env.ELECTRON_RUN_AS_NODE = "1";
    const request = { method: "provider/models", params: { cwd: root, providerOptions: {
      acpLaunchSpec: { command: process.execPath, args: [], env: { QWEN_HOME: home, QWEN_CODE_SYSTEM_SETTINGS_PATH: system } },
    } } };
    const result = await prepareModelOverlay(request);
    const spec = result.params.providerOptions.acpLaunchSpec;
    assert.equal(spec.env.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(spec.env.TEST_KEY, "forwarded");
  } finally {
    globalThis.fetch = originalFetch;
    if (original === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = original;
    delete process.env.QWEN_CODE_SYSTEM_SETTINGS_PATH;
    delete process.env.QWEN_CODE_SYSTEM_DEFAULTS_PATH;
    delete process.env.TEST_KEY;
    await rm(root, { recursive: true, force: true });
  }
});

test("overlay paths are reused across turns and concurrent prepares; changed inputs retain old files", async () => {
  const root = await mkdtemp(join(tmpdir(), "qwen-reuse-test-"));
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  try {
    const home = join(root, "home"); await mkdir(home);
    const system = join(root, "system.json");
    await writeFile(system, "{}");
    const settings = { modelProviders: { openai: [
      { id: "configured", baseUrl: base, envKey: "OVERLAY_REUSE_KEY" },
    ] } };
    await writeFile(join(home, "settings.json"), JSON.stringify(settings));
    let catalog = "catalog-first";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ data: [{ id: catalog }] }));
    }) as typeof fetch;
    const launch = { command: process.execPath, args: ["--version"], env: {
      QWEN_HOME: home, QWEN_CODE_SYSTEM_SETTINGS_PATH: system,
      OVERLAY_REUSE_KEY: "reuse-secret-first",
    } };
    const prepare = async (method = "thread/resume") => {
      const providerOptions = { acpLaunchSpec: launch };
      const result = await prepareModelOverlay({ method, params: { cwd: root,
        ...(["provider/models", "model/list"].includes(method)
          ? { providerOptions } : { options: { providerOptions } }),
      } });
      return (result.params.providerOptions ?? result.params.options.providerOptions).acpLaunchSpec;
    };
    const [first, concurrent] = await Promise.all([prepare(), prepare()]);
    assert.deepEqual(first, concurrent);
    for (const method of ["provider/models", "model/list", "thread/start", "thread/resume"]) {
      assert.deepEqual(await prepare(method), first);
    }
    assert.equal(calls, 1);
    const generations = [first];
    const changed = async () => {
      const next = await prepare();
      assert.notEqual(next.args[0], generations.at(-1).args[0]);
      assert.notEqual(next.env.QWEN_CODE_SYSTEM_SETTINGS_PATH, generations.at(-1).env.QWEN_CODE_SYSTEM_SETTINGS_PATH);
      assert.deepEqual(await prepare(), next);
      generations.push(next);
    };
    catalog = "catalog-second";
    Date.now = () => originalNow() + 6 * 60_000;
    await changed();
    assert.ok((await readFile(generations.at(-1).env.QWEN_CODE_SYSTEM_SETTINGS_PATH, "utf8")).includes(catalog));
    await writeFile(system, JSON.stringify({ security: { policy: "changed" } }));
    await changed();
    settings.modelProviders.openai[0].baseUrl = "https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1";
    await writeFile(join(home, "settings.json"), JSON.stringify(settings));
    await changed();
    launch.env.OVERLAY_REUSE_KEY = "reuse-secret-second";
    await changed();
    launch.args = ["--help"];
    await changed();
    for (const generation of generations) {
      const text = await readFile(generation.env.QWEN_CODE_SYSTEM_SETTINGS_PATH, "utf8");
      const proxy = await readFile(generation.args[0], "utf8");
      assert.ok(!text.includes("reuse-secret") && !proxy.includes("reuse-secret"));
    }
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    await rm(root, { recursive: true, force: true });
  }
});
