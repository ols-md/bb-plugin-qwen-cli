import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { QWEN_ACP_DIALECT_ID } from "./dialect.ts";
import { QWEN_WORKFLOW_ENV } from "./workflow-policy.ts";

const launchSpec = {
  displayName: "Qwen Code CLI",
  command: "qwen",
  args: ["--acp", "--channel", "ACP"],
  env: QWEN_WORKFLOW_ENV,
};

export default async function qwenPlugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Enable Qwen CLI",
      description:
        "Show Qwen Code in the provider picker. Existing running turns are not stopped.",
      default: true,
    },
    autoApprove: {
      type: "boolean",
      label: "Automatically approve ACP permission requests",
      description:
        "Automatically answer Qwen permission requests for commands, file changes, and tools in Accept edits mode. Applies to new turns.",
      default: false,
    },
    sandbox: {
      type: "boolean",
      label: "Run in sandbox",
      description:
        "Add --sandbox for new threads. When off, inherits Qwen CLI settings. Full access can approve requests outside the sandbox.",
      default: false,
    },
    subagentsDisabled: {
      type: "boolean",
      label: "Disable native subagents",
      description:
        "Prevent Qwen Code from using its native subagent tools so agents delegate work via BB child threads instead.",
      default: false,
    },
    commandDescriptionsEnabled: {
      type: "boolean",
      label: "Show command descriptions",
      description:
        "Display Qwen's tool summaries on command execution cards instead of raw commands.",
      default: true,
    },
  });

  const register = () =>
    bb.providers.register({
      id: "qwen-cli",
      displayName: "Qwen CLI",
      icon: "./assets/provider.svg",
      family: "qwen",
      strings: {
        signInHint:
          "Run `qwen` interactively and use `/auth` to sign in, or set OPENAI_API_KEY + OPENAI_BASE_URL for headless use.",
        expiredHint:
          "Run `qwen` interactively and use `/auth` to refresh your sign-in.",
        installUrl: "https://qwenlm.github.io/qwen-code-docs/en/docs/getting-started/",
        brandPrefix: "Qwen ",
        iconTint: { light: "#615CED", dark: "#8B83F6" },
      },
      experimental_bridgeOptions: {
        acpLaunchSpec: launchSpec,
        acpDialect: QWEN_ACP_DIALECT_ID,
      },
      deriveProviderOptions({ settings: s }) {
        return {
          autoApprove: s.autoApprove === true,
          providerSubagentsEnabled: s.subagentsDisabled !== true,
          commandDescriptionsEnabled: s.commandDescriptionsEnabled !== false,
          acpDialect: QWEN_ACP_DIALECT_ID,
          acpLaunchSpec: {
            ...launchSpec,
            args: [
              ...launchSpec.args,
              ...(s.sandbox === true ? ["--sandbox"] : []),
            ],
          },
        };
      },
      experimental_nativeSkillRoots: {
        user: [".qwen/skills"],
        project: [".qwen/skills"],
      },
      experimental_visibility: "always",
      maintenance: { health: true, usage: true, installation: true },
      capabilities: {
        supportsServiceTier: false,
        supportsNativeUserQuestion: false,
        fork: "none",
        supportsManualCompaction: false,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ["accept-edits", "full"],
        reasoningLevels: ["low", "medium", "high"],
      },
      composerActions: ["plan"],
      models: { fallback: [], scope: "workspace" },
    });

  let registration = (await settings.get()).enabled ? register() : undefined;
  settings.onChange(({ enabled }) => {
    if (Boolean(registration) === enabled) return;
    registration?.dispose();
    registration = enabled ? register() : undefined;
  });
}
