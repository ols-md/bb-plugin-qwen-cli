import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ProviderUsageResult } from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_execHostFile, experimental_hostToolchain } from "@get-bb/plugin-sdk/process";

const USAGE_TIMEOUT_MS = 15_000;

// ---- Token usage from local file ----

interface TokenEntry {
  schemaVersion: number;
  id: string;
  timestamp: string;
  localDate: string;
  sessionId: string;
  model: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thoughtsTokens: number;
}

function readLocalTokenUsage(): Map<string, number> {
  const byModel = new Map<string, number>();
  try {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const usageDir = join(homedir(), ".qwen", "usage");
    const file = join(usageDir, `token-usage-${month}.jsonl`);

    if (!existsSync(file)) return byModel;

    const lines = readFileSync(file, "utf-8").trim().split("\n");
    for (const line of lines) {
      try {
        const entry: TokenEntry = JSON.parse(line);
        if (typeof entry.totalTokens === "number" && entry.model) {
          const prev = byModel.get(entry.model) ?? 0;
          byModel.set(entry.model, prev + entry.totalTokens);
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file read error — return empty
  }
  return byModel;
}

// ---- Plan limits (approximate, from docs) ----

const PLAN_LIMITS: Record<string, number> = {
  // Token Plan models — approximate monthly limits in tokens
  "qwen3.8-max": 10_000_000,
  "qwen3.7-plus": 10_000_000,
  "qwen3.8-flash": 50_000_000,
  "deepseek-v4-pro-0813": 10_000_000,
  "deepseek-v4.1-flash": 50_000_000,
  "glm-5.3": 10_000_000,
};

interface QwenProviderConfig {
  displayName: string;
  providerId: string;
}

function readQwenProviderConfig(): QwenProviderConfig | null {
  try {
    const settingsPath = join(homedir(), ".qwen", "settings.json");
    if (!existsSync(settingsPath)) return null;
    const raw = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const providers = raw?.providers;
    if (!providers || typeof providers !== "object") return null;

    // Find the active provider
    for (const [key, val] of Object.entries(providers)) {
      const p = val as any;
      if (p?.apiKey && typeof p.apiKey === "string" && p.displayName) {
        return { providerId: key, displayName: p.displayName };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ---- Auth check via CLI ----

function isUnauthenticated(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("not signed in") ||
    lower.includes("authentication required") ||
    (lower.includes("login") && lower.includes("required")) ||
    lower.includes("unauthenticated") ||
    lower.includes("no api key") ||
    lower.includes("missing api key")
  );
}

function isExpired(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("token expired") ||
    lower.includes("session expired") ||
    lower.includes("invalid_grant") ||
    lower.includes("reauthenticate") ||
    lower.includes("api key invalid") ||
    lower.includes("unauthorized")
  );
}

// ---- Main usage function ----

export async function readQwenProviderUsage(options?: {
  command?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ProviderUsageResult> {
  const command = options?.command ?? "qwen";
  const cwd = options?.cwd ?? process.cwd();
  const env = options?.env ?? process.env;

  // Check if Qwen CLI is installed
  try {
    const resolved = experimental_hostToolchain.resolve(command, { cwd, env });
    if (!resolved) {
      return { supported: true, usage: { status: "not_installed" } };
    }
  } catch {
    return { supported: true, usage: { status: "not_installed" } };
  }

  // Check auth status by running doctor
  try {
    const { stdout, stderr } = await experimental_execHostFile(
      command,
      ["-p", "/doctor", "--output-format", "json"],
      { cwd, env, timeout: USAGE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    );

    const combined = `${stdout}\n${stderr}`;
    if (isUnauthenticated(combined)) {
      return { supported: true, usage: { status: "unauthenticated" } };
    }
    if (isExpired(combined)) {
      return { supported: true, usage: { status: "expired" } };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (
      (error as any)?.code === "ENOENT" ||
      msg.includes("not found") ||
      msg.includes("ENOENT")
    ) {
      return { supported: true, usage: { status: "not_installed" } };
    }
    return { supported: true, usage: { status: "error", message: "Qwen CLI check failed.", planLabel: null, accountEmail: null } };
  }

  // Read config and local usage
  const config = readQwenProviderConfig();
  const tokenUsage = readLocalTokenUsage();

  const windows = [...tokenUsage.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([model, tokens]) => {
      const limit = PLAN_LIMITS[model];
      const usedPercent = limit ? Math.min(100, Math.round((tokens / limit) * 100)) : 0;
      return {
        label: model,
        usedPercent,
        resetsAt: null,
        kind: "custom" as const,
        model: null as null,
      };
    });

  // Add aggregate if multiple models
  if (windows.length > 1) {
    const totalTokens = [...tokenUsage.values()].reduce((a, b) => a + b, 0);
    const totalLimit = [...tokenUsage.keys()]
      .map((m) => PLAN_LIMITS[m])
      .filter(Boolean)
      .reduce((a, b) => (a ?? 0) + (b ?? 0), 0);
    windows.unshift({
      label: `${config?.displayName ?? "Qwen"} (total)`,
      usedPercent: totalLimit ? Math.min(100, Math.round((totalTokens / totalLimit) * 100)) : 0,
      resetsAt: null,
      kind: "custom" as const,
      model: null as null,
    });
  } else if (windows.length === 0 && config) {
    windows.push({
      label: config.displayName,
      usedPercent: 0,
      resetsAt: null,
      kind: "custom" as const,
      model: null as null,
    });
  }

  return {
    supported: true,
    usage: {
      status: "ok",
      accountEmail: null,
      planLabel: config?.displayName ?? "Qwen",
      windows,
    },
  };
}