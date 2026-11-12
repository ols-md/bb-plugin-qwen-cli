import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ProviderUsageResult } from "@get-bb/plugin-sdk/provider-bridge";

// Strip "[Provider Name] " prefix from model/plan names
function cleanName(name: string): string {
  return name.replace(/^\[.+?\]\s*/, "");
}

// ---- Token usage from local file ----

interface TokenEntry {
  schemaVersion: number;
  id: string;
  timestamp: string;
  localDate: string;
  model: string;
  totalTokens: number;
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
  "qwen3.8-max": 10_000_000,
  "qwen3.7-plus": 10_000_000,
  "qwen3.8-flash": 50_000_000,
  "qwen4-max-preview": 10_000_000,
  "deepseek-v4-pro-0813": 10_000_000,
  "deepseek-v4.1-flash": 50_000_000,
  "glm-5.3": 10_000_000,
};

// ---- Provider config from settings file ----

interface QwenProviderConfig {
  displayName: string;
  providerId: string;
  hasKey: boolean;
}

function readQwenProviderConfig(): QwenProviderConfig | null {
  try {
    const settingsPath = join(homedir(), ".qwen", "settings.json");
    if (!existsSync(settingsPath)) return null;
    const raw = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const providers = raw?.providers;
    if (!providers || typeof providers !== "object") return null;

    for (const [key, val] of Object.entries(providers)) {
      const p = val as any;
      if (p?.displayName) {
        return {
          providerId: key,
          displayName: p.displayName,
          hasKey: typeof p.apiKey === "string" && p.apiKey.length > 0,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function isInstalled(): boolean {
  return existsSync(join(homedir(), ".qwen", "settings.json"));
}

// ---- Main usage function ----

export async function readQwenProviderUsage(): Promise<ProviderUsageResult> {
  if (!isInstalled()) {
    return { supported: true, usage: { status: "not_installed" } };
  }

  const config = readQwenProviderConfig();
  if (!config) {
    return { supported: true, usage: { status: "not_installed" } };
  }

  if (!config.hasKey) {
    return { supported: true, usage: { status: "unauthenticated" } };
  }

  const tokenUsage = readLocalTokenUsage();
  const planLabel = cleanName(config.displayName);

  const windows = [...tokenUsage.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([model, tokens]) => {
      const limit = PLAN_LIMITS[model];
      const usedPercent = limit ? Math.min(100, Math.round((tokens / limit) * 100)) : 0;
      return {
        label: cleanName(model),
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
      label: `${planLabel} (total)`,
      usedPercent: totalLimit ? Math.min(100, Math.round((totalTokens / totalLimit) * 100)) : 0,
      resetsAt: null,
      kind: "custom" as const,
      model: null as null,
    });
  } else if (windows.length === 0) {
    windows.push({
      label: planLabel,
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
      planLabel,
      windows,
    },
  };
}