import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { homedir, tmpdir, platform } from "node:os";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

type Settings = Record<string, any>;
const endpoints = new Set([
  "https://token-plan.maas.qwencloudapi.com/compatible-mode/v1",
  "https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1",
]);
const cache = new Map<string, { until: number; ids: string[]; pending?: Promise<string[]> }>();

export function chatIds(body: any): string[] {
  if (!Array.isArray(body?.data)) throw new Error("Invalid catalog");
  return [...new Set<string>(body.data.slice(0, 2000).flatMap((m: any) =>
    typeof m?.id === "string" && /^[\w.:-]{1,200}$/.test(m.id) &&
    !/^(auto$|wan|qwen-(image|audio)|.*(?:image|audio|video|embedding|rerank))/i.test(m.id) ? [m.id] : []))];
}

export async function discover(base: string, key: string, fetcher = fetch): Promise<string[]> {
  if (!endpoints.has(base)) return [];
  const identity = createHash("sha256").update(base).update(key).digest("hex");
  const prior = cache.get(identity);
  if (prior?.pending) return prior.pending;
  if (prior && prior.until > Date.now()) return prior.ids;
  const entry = { until: Date.now() + 60_000, ids: prior?.ids ?? [] } as NonNullable<typeof prior>;
  entry.pending = (async () => {
    try {
      const response = await fetcher(`${base}/models`, {
        headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(5000),
      });
      if (!response.ok || !response.body) throw new Error("Catalog unavailable");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 512_000) throw new Error("Catalog too large");
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      entry.ids = chatIds(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      entry.until = Date.now() + 5 * 60_000;
    } catch (err) { console.error("[qwen] model discovery failed:", (err as Error)?.message ?? err); }
    return entry.ids;
  })().finally(() => { delete entry.pending; });
  cache.set(identity, entry);
  if (cache.size > 32) cache.delete(cache.keys().next().value!);
  return entry.pending;
}

async function readSettings(path: string): Promise<Settings> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error: any) { if (error.code === "ENOENT") return {}; throw error; }
}

export function mergeSettings(a: Settings, b: Settings): Settings {
  const result = { ...a };
  for (const [key, value] of Object.entries(b)) {
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeSettings(a[key] ?? {}, value) : value;
  }
  return result;
}

// Paths remain valid for all child settings reloads, and are removed with the host worker.
const directories = new Set<string>();
const overlays = new Map<string, Promise<{ path: string; proxy: string }>>();
process.once("exit", () => { for (const dir of directories) rmSync(dir, { recursive: true, force: true }); });

export async function prepareModelOverlay(request: Settings): Promise<Settings> {
  if (!["provider/models", "model/list", "thread/start", "thread/resume"].includes(request.method)) return request;
  const listing = ["provider/models", "model/list"].includes(request.method);
  const po = listing ? request.params?.providerOptions : request.params?.options?.providerOptions;
  const launch = po?.acpLaunchSpec;
  if (!launch) return request;
  let dir: string | undefined;
  try {
    const env = { ...process.env, ...launch.env };
    const systemPath = env.QWEN_CODE_SYSTEM_SETTINGS_PATH ?? (platform() === "win32"
      ? "C:\\ProgramData\\qwen-code\\settings.json" : platform() === "darwin"
        ? "/Library/Application Support/QwenCode/settings.json" : "/etc/qwen-code/settings.json");
    const defaultsPath = env.QWEN_CODE_SYSTEM_DEFAULTS_PATH ?? join(dirname(systemPath), "system-defaults.json");
    const home = env.QWEN_HOME ? resolve(env.QWEN_HOME.replace(/^~(?=[/\\]|$)/, homedir())) : join(homedir(), ".qwen");
    const [defaults, user, system] = await Promise.all([readSettings(defaultsPath), readSettings(join(home, "settings.json")), readSettings(systemPath)]);
    // Workspace credentials are deliberately not trusted by this host-side network operation.
    const effective = mergeSettings(mergeSettings(defaults, user), system);
    // Only skip discovery when the workspace overrides a Token Plan provider with its own routes.
    const workspace = resolve(request.params?.cwd ?? request.params?.options?.cwd ?? process.cwd());
    const wsProviders = (await readSettings(join(workspace, ".qwen", "settings.json"))).modelProviders;
    if (wsProviders && typeof wsProviders === "object") {
      for (const models of Object.values(wsProviders) as any[]) {
        if (!Array.isArray(models)) continue;
        if (models.some((m: any) => endpoints.has(typeof m.baseUrl === "string" ? m.baseUrl.replace(/\/$/, "") : ""))) return request;
      }
    }
    // Moving System env into process.env would change Qwen's env precedence.
    if (Object.keys(system.env ?? {}).length) return request;
    const credentials = { ...effective.env, ...env };
    const providers = structuredClone(effective.modelProviders ?? {});
    let enabled = false;
    for (const models of Object.values(providers) as any[]) {
      if (!Array.isArray(models)) continue;
      const routes = new Map<string, any>();
      for (const model of models) {
        const base = typeof model.baseUrl === "string" ? model.baseUrl.replace(/\/$/, "") : "";
        if (endpoints.has(base) && typeof model.envKey === "string") routes.set(`${base}\0${model.envKey}`, model);
      }
      for (const route of routes.values()) {
        const key = credentials[route.envKey];
        if (typeof key !== "string" || !key) continue;
        enabled = true;
        for (const id of await discover(route.baseUrl.replace(/\/$/, ""), key)) {
          if (models.some((m: any) => m.id === id && m.baseUrl === route.baseUrl)) continue;
          models.push({ id, name: id, baseUrl: route.baseUrl, envKey: route.envKey });
        }
      }
    }
    if (!enabled) return request;
    const overlay: Settings = { ...system, modelProviders: providers };
    // Never serialize settings.env or inline provider credentials into temporary storage.
    // The child's own settings env is missing (deleted above), so forward merged env values through the process environment.
    const childEnv: Record<string, string> = { ...launch.env };
    for (const block of [defaults.env, user.env, system.env] as Settings[]) {
      if (!block || typeof block !== "object" || Array.isArray(block)) continue;
      for (const [key, value] of Object.entries(block)) {
        if (typeof value === "string") childEnv[key] = value;
      }
    }
    // When the host worker runs as an Electron binary (Windows desktop bb), spawning process.execPath
    // bootstraps the GUI unless ELECTRON_RUN_AS_NODE is set; the child then exits 0 instantly.
    if (process.env.ELECTRON_RUN_AS_NODE) childEnv.ELECTRON_RUN_AS_NODE = "1";
    delete overlay.env;
    let index = 0;
    for (const models of Object.values(providers) as any[]) {
      if (!Array.isArray(models)) continue;
      for (const model of models) if (typeof model.apiKey === "string") {
        const name = `BB_QWEN_OVERLAY_KEY_${index++}`;
        childEnv[name] = model.apiKey; delete model.apiKey; model.envKey = name;
      }
    }
    // Unknown secret-bearing system policy cannot safely be relocated; retain the original configuration.
    if (/"(?:env|[^"\s]*(?:api[_-]?key|password|token|secret|authorization)[^"\s]*)"\s*:/i.test(JSON.stringify(overlay))) return request;
    // Only a digest of credentials participates in reuse; generated files contain no secrets.
    const identity = createHash("sha256").update(JSON.stringify(
      [launch, effective, env, defaultsPath, systemPath, home, overlay],
      (_key, value) => value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value,
    )).digest("hex");
    let files = overlays.get(identity);
    if (!files) {
      files = (async () => {
        dir = await mkdtemp(join(tmpdir(), "bb-qwen-models-"));
        const path = join(dir, "settings.json");
        await writeFile(path, JSON.stringify(overlay), { mode: 0o600 });
        // Guard the SDK's legacy fallback too: Qwen otherwise persists session/set_model.
        const proxy = join(dir, "acp.mjs");
        await writeFile(proxy, `import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const child=spawn(${JSON.stringify(launch.command)},${JSON.stringify(launch.args)}, {stdio:['pipe','inherit','inherit'],shell:process.platform==='win32' && !${JSON.stringify(launch.command)}.toLowerCase().endsWith('.exe'),windowsHide:true});
createInterface({input:process.stdin}).on('line',line=>{
 try {const m=JSON.parse(line);if(m.method==='session/set_model') {m.params={...m.params,_meta:{...m.params?._meta,'qwen.session.modelPersistDefault':false}};line=JSON.stringify(m);}} catch {}
 child.stdin.write(line+'\\n');
}).on('close',()=>child.stdin.end());
// The bridge reuses this launcher for catalog probes; host exit owns cleanup.
child.on('exit',code=>process.exit(code??1));
child.on('error',()=>process.exit(1));
process.on('SIGTERM',()=>child.kill());
`, { mode: 0o600 });
        directories.add(dir);
        return { path, proxy };
      })();
      overlays.set(identity, files);
      // Retry failed writes, while keeping successful generations alive until host exit.
      void files.catch(() => { overlays.delete(identity); });
    }
    const { path, proxy } = await files;
    childEnv.QWEN_CODE_SYSTEM_SETTINGS_PATH = path;
    childEnv.QWEN_CODE_SYSTEM_DEFAULTS_PATH = defaultsPath;
    const providerOptions = { ...po, acpLaunchSpec: { ...launch, command: process.execPath, args: [proxy], env: childEnv } };
    return { ...request, params: { ...request.params, ...(listing ? { providerOptions }
      : { options: { ...request.params.options, providerOptions } }) } };
  } catch (err) {
    console.error("[qwen] model overlay failed:", (err as Error)?.message ?? err);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    return request;
  }
}
