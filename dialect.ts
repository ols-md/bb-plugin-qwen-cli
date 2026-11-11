import {
  experimental_registerAcpDialect,
  type AcpDialect,
  type AcpToolCallUpdateEvent,
  type AcpToolKind,
} from "@get-bb/plugin-sdk/provider-bridge/acp";

// ---- Public types ----

export type AcpToolUpdateEvent = AcpToolCallUpdateEvent;

export interface DialectPresentation {
  label: { pending: string; completed: string };
  icon: { glyph: string };
  title?: string;
  subtitle?: string;
  detail?: string;
}

export type AcpDialectToolClassification =
  | { kind: "command"; presentation: DialectPresentation; item?: Record<string, unknown> }
  | { kind: "tool_use"; tool: string; detail?: string | null; presentation: DialectPresentation; item?: Record<string, unknown> }
  | { kind: "delegation"; label: string; detail?: string | null; background: boolean; childRef?: string; presentation: DialectPresentation; item?: Record<string, unknown> };

// ---- Constants ----

const PRESENTATION_DETAIL_MAX_LENGTH = 280;
function trunc(text: string): string {
  return text.length > PRESENTATION_DETAIL_MAX_LENGTH ? `${text.slice(0, PRESENTATION_DETAIL_MAX_LENGTH - 3)}...` : text;
}

export const QWEN_ACP_DIALECT_ID = "qwen";

// Qwen Code tools (fork of Gemini CLI — same canonical tools)
const CANONICAL_TOOLS = new Set([
  "run_command", "read_file", "write_file", "edit",
  "grep_search", "glob", "web_fetch", "web_search",
  "list_dir", "view_file", "view_file_outline", "view_code_item",
  "list_resources", "read_resource",
  "search_web", "read_url_content",
  "invoke_subagent", "define_subagent", "manage_subagents", "send_message",
  "manage_task", "schedule",
  "ask_question",
]);

// ---- Tool name inference ----

function norm(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  return CANONICAL_TOOLS.has(t) ? t : CANONICAL_TOOLS.has(t.replace(/\s+/g, "_")) ? t.replace(/\s+/g, "_") : null;
}

export function inferToolName(event: AcpToolUpdateEvent): string | null {
  if (!event || typeof event !== "object") return null;
  const meta = (event as Record<string, unknown>)._meta;
  if (meta && typeof meta === "object") {
    const m = meta as Record<string, unknown>;
    const n = norm(m.tool) ?? norm(m.name) ?? norm(m.toolName) ?? norm(m.tool_name);
    if (n) return n;
  }
  if (typeof event.name === "string") { const n = norm(event.name); if (n) return n; }
  if (typeof event.title === "string") {
    const n = norm(event.title);
    if (n) return n;
    const ci = event.title.indexOf(":");
    if (ci > 0) { const p = norm(event.title.slice(0, ci)); if (p) return p; }
  }
  // Structural inference
  const ri = event.rawInput as Record<string, unknown> | undefined;
  if (ri && typeof ri === "object" && !Array.isArray(ri)) {
    if (typeof ri.CommandLine === "string" || typeof ri.command === "string") return "run_command";
    if (typeof ri.TypeName === "string" && typeof ri.Prompt === "string") return "invoke_subagent";
    if (typeof ri.SystemPrompt === "string" && typeof ri.Name === "string" && typeof ri.Description === "string") return "define_subagent";
    if (typeof ri.Action === "string" && (Array.isArray(ri.ConversationIds) || ri.Action === "kill_all")) return "manage_subagents";
    if (typeof ri.Recipient === "string" && typeof ri.Message === "string") return "send_message";
    if (typeof ri.Action === "string" && (typeof ri.TaskId === "string" || ri.Input !== undefined || ["list", "kill", "status", "send_input"].includes(ri.Action as string))) return "manage_task";
    if (typeof ri.Prompt === "string" && (typeof ri.DurationSeconds === "number" || typeof ri.CronExpression === "string")) return "schedule";
    if (Array.isArray(ri.questions)) return "ask_question";
    if (typeof ri.file_path === "string") return "read_file";
    if (typeof ri.url === "string") return "web_fetch";
    if (typeof ri.pattern === "string") return "grep_search";
  }
  return null;
}

function kindFor(name: string | null, fallback?: AcpToolKind): AcpToolKind {
  if (!name) return fallback ?? "other";
  switch (name) {
    case "run_command": return "execute";
    case "read_file": case "view_file": case "view_file_outline": case "view_code_item": case "list_dir": case "list_resources": case "read_resource": return "read";
    case "write_file": case "edit": return "edit";
    case "grep_search": case "glob": case "find_by_name": return "search";
    case "web_fetch": case "web_search": case "search_web": case "read_url_content": return "fetch";
    default: return fallback ?? "other";
  }
}

// ---- Tool identity ----

export function toolIdentity(event: AcpToolUpdateEvent) {
  const name = inferToolName(event);
  if (name) return { name, kind: kindFor(name, event.kind as AcpToolKind) };
  if (typeof event.name === "string" && event.name.trim()) return { name: event.name.trim(), kind: kindFor(event.name.trim(), event.kind as AcpToolKind) };
  if (event.kind) return { kind: event.kind as AcpToolKind };
  return null;
}

// ---- Tool classification ----

export function classifyToolCall(event: AcpToolUpdateEvent): AcpDialectToolClassification | null {
  const name = inferToolName(event);
  if (!name) return null;

  const ri = (event.rawInput && typeof event.rawInput === "object" && !Array.isArray(event.rawInput)) ? (event.rawInput as Record<string, unknown>) : {};

  switch (name) {
    case "run_command": {
      const cmd = typeof ri.CommandLine === "string" ? ri.CommandLine : typeof ri.command === "string" ? ri.command : undefined;
      const summary = typeof ri.toolSummary === "string" ? ri.toolSummary : typeof ri.description === "string" ? ri.description : undefined;
      const pres: DialectPresentation = {
        label: { pending: "Running command", completed: "Ran command" },
        icon: { glyph: "Terminal" },
        ...(summary ? { title: summary.trim(), ...(cmd ? { detail: trunc(cmd), subtitle: cmd } : {}) } : { title: cmd || event.title || "Command" }),
      };
      return { kind: "command", presentation: pres, item: { type: "command", command: cmd ?? "", cwd: "" } };
    }
    case "read_file": case "view_file": case "view_file_outline": case "view_code_item": {
      const fp = typeof ri.file_path === "string" ? ri.file_path : typeof ri.Path === "string" ? ri.Path : undefined;
      const pres: DialectPresentation = {
        label: { pending: "Reading file", completed: "Read file" },
        icon: { glyph: "FileText" },
        title: fp ? `Read ${fp}` : "Read file",
        ...(fp ? { detail: trunc(fp), subtitle: fp } : {}),
      };
      return { kind: "tool_use", tool: name, presentation: pres };
    }
    case "write_file": {
      const fp = typeof ri.file_path === "string" ? ri.file_path : typeof ri.Path === "string" ? ri.Path : undefined;
      const pres: DialectPresentation = {
        label: { pending: "Writing file", completed: "Wrote file" },
        icon: { glyph: "FilePlus" },
        title: fp ? `Write ${fp}` : "Write file",
        ...(fp ? { detail: trunc(fp), subtitle: fp } : {}),
      };
      return { kind: "tool_use", tool: "write_file", presentation: pres };
    }
    case "edit": {
      const fp = typeof ri.file_path === "string" ? ri.file_path : typeof ri.Path === "string" ? ri.Path : undefined;
      const pres: DialectPresentation = {
        label: { pending: "Editing file", completed: "Edited file" },
        icon: { glyph: "FileEdit" },
        title: fp ? `Edit ${fp}` : "Edit file",
        ...(fp ? { detail: trunc(fp), subtitle: fp } : {}),
      };
      return { kind: "tool_use", tool: "edit", presentation: pres };
    }
    case "grep_search": case "code_search": {
      const pat = typeof ri.pattern === "string" ? ri.pattern : typeof ri.query === "string" ? ri.query : undefined;
      const pres: DialectPresentation = {
        label: { pending: "Searching code", completed: "Searched code" },
        icon: { glyph: "Search" },
        title: pat ? `Search: ${pat}` : "Search code",
        ...(pat ? { detail: trunc(pat), subtitle: pat } : {}),
      };
      return { kind: "tool_use", tool: name, presentation: pres };
    }
    case "glob": case "find_by_name": {
      const pat = typeof ri.pattern === "string" ? ri.pattern : undefined;
      const pres: DialectPresentation = {
        label: { pending: "Finding files", completed: "Found files" },
        icon: { glyph: "FolderSearch" },
        title: pat ? `Find: ${pat}` : "Find files",
        ...(pat ? { detail: trunc(pat), subtitle: pat } : {}),
      };
      return { kind: "tool_use", tool: name, presentation: pres };
    }
    case "list_dir": case "list_resources": {
      const p = typeof ri.path === "string" ? ri.path : typeof ri.directory === "string" ? ri.directory : undefined;
      const pres: DialectPresentation = {
        label: { pending: "Listing directory", completed: "Listed directory" },
        icon: { glyph: "FolderOpen" },
        title: p ? `List ${p}` : "List directory",
        ...(p ? { detail: trunc(p), subtitle: p } : {}),
      };
      return { kind: "tool_use", tool: name, presentation: pres };
    }
    case "web_fetch": case "read_url_content": {
      const url = typeof ri.url === "string" ? ri.url : undefined;
      const pres: DialectPresentation = {
        label: { pending: "Fetching URL", completed: "Fetched URL" },
        icon: { glyph: "Globe" },
        title: url || "Fetch URL",
        ...(url ? { detail: trunc(url), subtitle: url } : {}),
      };
      return { kind: "tool_use", tool: name, presentation: pres };
    }
    case "web_search": case "search_web": {
      const q = typeof ri.query === "string" ? ri.query : typeof ri.search === "string" ? ri.search : undefined;
      const pres: DialectPresentation = {
        label: { pending: "Searching web", completed: "Searched web" },
        icon: { glyph: "Globe" },
        title: q ? `Search: ${q}` : "Web search",
        ...(q ? { detail: trunc(q), subtitle: q } : {}),
      };
      return { kind: "tool_use", tool: name, presentation: pres };
    }
    case "invoke_subagent": {
      const role = typeof ri.Role === "string" && ri.Role.trim() ? ri.Role.trim() : typeof ri.TypeName === "string" && ri.TypeName.trim() ? ri.TypeName.trim() : "Subagent";
      const prompt = typeof ri.Prompt === "string" && ri.Prompt.trim() ? ri.Prompt.trim() : undefined;
      const detail = prompt ? (prompt.length > 120 ? `${prompt.slice(0, 117)}...` : prompt) : null;
      const pres: DialectPresentation = {
        label: { pending: "Running subagent", completed: "Subagent launched" },
        icon: { glyph: "Bot" },
        title: role,
        ...(detail ? { detail: trunc(detail), subtitle: detail } : {}),
      };
      return { kind: "delegation", label: role, detail, background: true, presentation: pres, item: { type: "delegation", childRef: event.toolCallId, label: role, summary: detail || undefined, background: true } };
    }
    case "define_subagent": {
      const n = typeof ri.Name === "string" && ri.Name.trim() ? ri.Name.trim() : undefined;
      const desc = typeof ri.Description === "string" && ri.Description.trim() ? ri.Description.trim() : undefined;
      const pres: DialectPresentation = {
        label: { pending: "Defining subagent", completed: "Defined subagent" },
        icon: { glyph: "Bot" },
        title: n ? `Define subagent ${n}` : "Define subagent",
        ...(desc ? { detail: trunc(desc), subtitle: desc } : {}),
      };
      return { kind: "tool_use", tool: "define_subagent", detail: desc || n || null, presentation: pres };
    }
    case "manage_subagents": {
      const action = typeof ri.Action === "string" ? ri.Action.trim() : undefined;
      const ids = Array.isArray(ri.ConversationIds) ? ri.ConversationIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0).join(", ") : undefined;
      let pend = "Managing subagents", comp = "Managed subagents";
      if (action === "list") { pend = "Listing subagents"; comp = "Listed subagents"; }
      else if (action === "kill" || action === "kill_all") { pend = "Stopping subagents"; comp = "Stopped subagents"; }
      const pres: DialectPresentation = {
        label: { pending: pend, completed: comp },
        icon: { glyph: "Bot" },
        title: action === "list" ? "List subagents" : action === "kill" || action === "kill_all" ? "Stop subagents" : "Manage subagents",
        ...(ids ? { detail: trunc(ids), subtitle: ids } : {}),
      };
      return { kind: "tool_use", tool: "manage_subagents", detail: ids || action || null, presentation: pres };
    }
    case "send_message": {
      const recipient = typeof ri.Recipient === "string" && ri.Recipient.trim() ? ri.Recipient.trim() : undefined;
      const msg = typeof ri.Message === "string" && ri.Message.trim() ? ri.Message.trim() : undefined;
      const pres: DialectPresentation = {
        label: { pending: "Messaging subagent", completed: "Messaged subagent" },
        icon: { glyph: "Bot" },
        title: recipient ? `Message ${recipient}` : "Message subagent",
        ...(msg ? { detail: trunc(msg.slice(0, 120)), subtitle: msg.slice(0, 120) } : {}),
      };
      return { kind: "tool_use", tool: "send_message", detail: recipient || null, presentation: pres };
    }
    case "manage_task": {
      const action = typeof ri.Action === "string" ? ri.Action.trim() : undefined;
      const tid = typeof ri.TaskId === "string" && ri.TaskId.trim() ? ri.TaskId.trim() : undefined;
      let pend = "Managing task", comp = "Managed task";
      if (action === "list") { pend = "Listing tasks"; comp = "Listed tasks"; }
      else if (action === "status") { pend = "Checking task"; comp = "Checked task"; }
      else if (action === "kill") { pend = "Stopping task"; comp = "Stopped task"; }
      else if (action === "send_input") { pend = "Sending input"; comp = "Sent input"; }
      const pres: DialectPresentation = {
        label: { pending: pend, completed: comp },
        icon: { glyph: "Terminal" },
        title: tid ? `${action || "Task"}: ${tid}` : action ? `Task ${action}` : "Manage task",
      };
      return { kind: "tool_use", tool: "manage_task", detail: tid || action || null, presentation: pres };
    }
    case "schedule": {
      const dur = typeof ri.DurationSeconds === "number" ? ri.DurationSeconds : undefined;
      const cron = typeof ri.CronExpression === "string" && ri.CronExpression.trim() ? ri.CronExpression.trim() : undefined;
      const prompt = typeof ri.Prompt === "string" && ri.Prompt.trim() ? ri.Prompt.trim() : undefined;
      const sched = typeof cron === "string" ? `cron: ${cron}` : typeof dur === "number" ? `${dur}s timer` : undefined;
      const pres: DialectPresentation = {
        label: { pending: "Scheduling task", completed: "Scheduled task" },
        icon: { glyph: "Clock" },
        title: sched ? `Schedule (${sched})` : "Schedule task",
        ...(prompt ? { detail: trunc(prompt.slice(0, 120)), subtitle: prompt.slice(0, 120) } : {}),
      };
      return { kind: "tool_use", tool: "schedule", detail: sched || prompt || null, presentation: pres };
    }
    default:
      return null;
  }
}

// ---- Dialect registration ----

export const qwenAcpDialect: AcpDialect = {
  id: QWEN_ACP_DIALECT_ID,
  toolIdentity: ((e: AcpToolUpdateEvent) => toolIdentity(e) ?? undefined) as any,
  classifyToolCall: ((e: AcpToolUpdateEvent) => classifyToolCall(e) ?? undefined) as any,
};

let registered = false;

export function registerQwenAcpDialect(): AcpDialect {
  if (!registered) {
    try { experimental_registerAcpDialect(qwenAcpDialect); } catch { /* already registered */ }
    registered = true;
  }
  return qwenAcpDialect;
}