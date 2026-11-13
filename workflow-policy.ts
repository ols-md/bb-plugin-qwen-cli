// BB owns workflow orchestration, including when resuming older Qwen threads.
export const QWEN_WORKFLOW_ENV = { QWEN_CODE_DISABLE_WORKFLOWS: "1" };

export function enforceWorkflowPolicy(request: any): void {
  if (!["provider/models", "model/list", "thread/start", "thread/resume", "turn/start"].includes(request?.method)) return;
  const options = request.params?.options;
  if (options?.sessionOptions) delete options.sessionOptions.workflow_mode;
  const providerOptions = ["provider/models", "model/list"].includes(request.method)
    ? request.params?.providerOptions : options?.providerOptions;
  const launch = providerOptions?.acpLaunchSpec;
  if (launch) launch.env = { ...launch.env, ...QWEN_WORKFLOW_ENV };
}

export function filterWorkflowOptions(message: any): void {
  for (const model of Array.isArray(message.result?.models) ? message.result.models : []) {
    if (Array.isArray(model.sessionOptions)) {
      model.sessionOptions = model.sessionOptions.filter((option: any) => option.id !== "workflow_mode");
    }
  }
  if (Array.isArray(message.result?.sessionOptions)) {
    message.result.sessionOptions = message.result.sessionOptions.filter((option: any) => option.id !== "workflow_mode");
  }
  for (const delta of Array.isArray(message.params?.deltas) ? message.params.deltas : []) {
    if (delta.kind === "extension.state" && delta.extensionKind === "bb/session-options" &&
        Array.isArray(delta.payload?.options)) {
      delta.payload.options = delta.payload.options.filter((option: any) => option.id !== "workflow_mode");
    }
  }
}
