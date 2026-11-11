import { experimental_execHostFile, experimental_hostToolchain } from "@get-bb/plugin-sdk/process";
import type { ProviderUsageResult } from "@get-bb/plugin-sdk/provider-bridge";

const USAGE_TIMEOUT_MS = 15_000;

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

interface QwenDoctorResult {
  provider?: string;
  baseUrl?: string;
  model?: string;
}

function parseDoctorOutput(stdout: string): QwenDoctorResult | null {
  try {
    const parsed = JSON.parse(stdout);
    // Search through stream-json output for the doctor result
    let resultText = "";
    for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
      if (entry?.type === "result" && typeof entry.result === "string") {
        resultText = entry.result;
        break;
      }
      if (entry?.type === "assistant" && entry.message?.content) {
        for (const block of entry.message.content) {
          if (block.type === "text" && typeof block.text === "string") {
            resultText = block.text;
            break;
          }
        }
      }
    }
    if (!resultText) return null;

    const doctor = JSON.parse(resultText);
    const authCheck = doctor?.checks?.find(
      (c: any) => c.category === "Authentication" && c.name === "API key",
    );
    if (authCheck?.detail) {
      // Parse "Provider: Token Plan\nBase URL: https://...\nModel: qwen3.8-max"
      const provider = authCheck.detail.match(/Provider:\s*(.+)/)?.[1]?.trim();
      const baseUrl = authCheck.detail.match(/Base URL:\s*(.+)/)?.[1]?.trim();
      const model = authCheck.detail.match(/Model:\s*(.+)/)?.[1]?.trim();
      return { provider, baseUrl, model };
    }
    return null;
  } catch {
    return null;
  }
}

export async function readQwenProviderUsage(options?: {
  command?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ProviderUsageResult> {
  const command = options?.command ?? "qwen";
  const cwd = options?.cwd ?? process.cwd();
  const env = options?.env ?? process.env;

  try {
    const resolved = experimental_hostToolchain.resolve(command, { cwd, env });
    if (!resolved) {
      return { supported: true, usage: { status: "not_installed" } };
    }

    const { stdout, stderr } = await experimental_execHostFile(
      resolved,
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

    const doctor = parseDoctorOutput(stdout);
    const planLabel = doctor?.provider ?? "Qwen";
    const accountEmail = null;

    // Build usage windows from doctor info — no real quota data,
    // but shows the provider is configured and working.
    const windows = doctor
      ? [
          {
            label: doctor.provider ?? "Account",
            usedPercent: 0,
            resetsAt: null,
            kind: "custom" as const,
            model: null as null,
          },
        ]
      : [];

    return {
      supported: true,
      usage: {
        status: "ok",
        accountEmail: null,
        planLabel,
        windows,
      },
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { supported: true, usage: { status: "not_installed" } };
    }
    const stderr =
      error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr
        : "";
    const combined = `${error instanceof Error ? error.message : String(error)}\n${stderr}`;
    if (isUnauthenticated(combined)) {
      return { supported: true, usage: { status: "unauthenticated" } };
    }
    if (isExpired(combined)) {
      return { supported: true, usage: { status: "expired" } };
    }
    return {
      supported: true,
      usage: {
        status: "error",
        message: "Qwen CLI usage could not be collected.",
        planLabel: null,
        accountEmail: null,
      },
    };
  }
}