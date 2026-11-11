import { experimental_acpProviderBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";
import {
  threadStartParamsSchema,
  threadResumeParamsSchema,
  turnStartParamsSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import { StringDecoder } from "node:string_decoder";
import { Transform } from "node:stream";
import { QWEN_ACP_DIALECT_ID, registerQwenAcpDialect } from "./dialect.ts";
import { mapPromptMode } from "./prompt-mode.ts";

registerQwenAcpDialect();

// ---- Per-thread state ----

const autoApproveThreads = new Map<string, boolean>();

function rememberSettings(request: any) {
  const method = request?.method;
  if (method === "thread/stop" || method === "thread/discard") {
    const tid = request?.params?.threadId;
    if (typeof tid === "string") autoApproveThreads.delete(tid);
    return;
  }
  const schema =
    method === "thread/start" ? threadStartParamsSchema
    : method === "thread/resume" ? threadResumeParamsSchema
    : method === "turn/start" ? turnStartParamsSchema
    : null;
  const parsed = schema?.safeParse(request.params);
  if (parsed?.success) {
    autoApproveThreads.set(
      parsed.data.threadId,
      parsed.data.options.providerOptions?.autoApprove === true &&
        parsed.data.options.permissionMode === "accept-edits" &&
        parsed.data.options.permissionEscalation === "ask",
    );
  }
}

// ---- Default dialect injection ----

function applyDialect(record: Record<string, any>): Record<string, any> {
  const params = record.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return record;
  const options = params.options;
  if (!options || typeof options !== "object" || Array.isArray(options)) return record;
  const po = options.providerOptions;
  if (!po || typeof po !== "object" || Array.isArray(po)) return record;
  if (po.acpDialect && po.acpDialect !== "acp") return record;

  return {
    ...record,
    params: {
      ...params,
      options: {
        ...options,
        providerOptions: { ...po, acpDialect: QWEN_ACP_DIALECT_ID },
      },
    },
  };
}

// ---- Auto-approve interception ----

function tryAutoApprove(line: string): string | null {
  let msg: any;
  try { msg = JSON.parse(line); } catch { return line; }

  if (
    msg?.jsonrpc !== "2.0" ||
    msg.method !== "interaction/request" ||
    (typeof msg.id !== "string" && typeof msg.id !== "number") ||
    !autoApproveThreads.get(msg.params?.threadId)
  ) return line;

  const payload = msg.params?.payload;
  if (payload?.kind !== "approval") return line;

  const subject = payload.subject;
  const isValidSubject =
    typeof subject?.itemId === "string" &&
    ["command", "file_change", "tool_use"].includes(subject.kind) &&
    Array.isArray(payload.availableDecisions) &&
    payload.availableDecisions.every((v: unknown) =>
      ["allow_once", "allow_for_session", "deny"].includes(v as string),
    );

  if (!isValidSubject) return line;

  const decisions = payload.availableDecisions as string[];
  const decision = decisions.includes("allow_once")
    ? "allow_once"
    : decisions.includes("allow_for_session")
      ? "allow_for_session"
      : null;
  if (!decision) return line;

  // Send approval back through the bridge
  queueMicrotask(() =>
    experimental_acpProviderBridge.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: { decision, grantedPermissions: null },
      }),
    ),
  );
  return null; // suppress this line from stdout
}

// ---- Stdout filter pipeline ----

let filterInstalled = false;

function installFilter() {
  if (filterInstalled) return;
  filterInstalled = true;

  const write = process.stdout.write.bind(process.stdout);
  const decoder = new StringDecoder("utf8");
  let pending = "";

  const transform = new Transform({
    transform(chunk, _encoding, done) {
      pending += decoder.write(chunk);
      let end: number;
      while ((end = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, end);
        const result = tryAutoApprove(line);
        if (result !== null) this.push(result + "\n");
        pending = pending.slice(end + 1);
      }
      done();
    },
    flush(done) {
      pending += decoder.end();
      if (pending && tryAutoApprove(pending) !== null) this.push(pending);
      done();
    },
  });

  transform.on("data", (chunk: Buffer) => write(chunk));
  (process.stdout as any).write = (chunk: any, encodingOrCallback?: any, callback?: any) =>
    transform.write(chunk, encodingOrCallback, callback);
}

// ---- Bridge export ----

export const experimental_providerBridge = {
  ...experimental_acpProviderBridge,
  start() {
    installFilter();
  },
  handleLine(line: string) {
    let parsed: Record<string, any> | null = null;
    try { parsed = JSON.parse(line); } catch { /* not JSON */ }

    if (parsed) {
      parsed = applyDialect(parsed);
      rememberSettings(parsed);
      line = mapPromptMode(JSON.stringify(parsed), parsed);
    }

    experimental_acpProviderBridge.handleLine(line);
  },
};