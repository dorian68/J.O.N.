import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_OPERATOR_PORT,
  DEFAULT_RUNTIME_RETENTION_DAYS,
  REAL_SURFACE_VALIDATION_ROOT
} from "../config.js";
import { PromptRegistry } from "../llm/prompt-registry.js";
import { buildLlmRuntimeConfig, buildPublicLlmConfigStatus } from "../llm/runtime-config.js";
import { resolveLlmRuntimeEnvironment } from "../llm/resolve-runtime-env.js";
import { getRealSurfaceScenarioCatalog } from "../validation/real-surface-catalog.js";
import { collectProofArtifacts } from "./proof-artifacts.js";
import { candidateBrowserPaths, assertLocalOperatorBaseUrl } from "../../../desktop/shell-foundation.mjs";

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveAvailableBrowserCandidate(candidates) {
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function buildReleaseDoctorReport({
  env = process.env,
  promptRegistryLoader = async () => new PromptRegistry().load(),
  validationRoot = REAL_SURFACE_VALIDATION_ROOT,
  secretStore,
  proofArtifacts = null
} = {}) {
  const warnings = [];
  const blocks = [];
  const { resolvedEnv, secretResolution } = await resolveLlmRuntimeEnvironment({
    env,
    secretStore
  });
  const llmConfig = buildLlmRuntimeConfig({
    env: resolvedEnv,
    secretResolution
  });
  const llmStatus = buildPublicLlmConfigStatus(llmConfig);
  const evidence = proofArtifacts ?? await collectProofArtifacts({
    validationRoot
  });

  if (!llmStatus.providers.openaiCompatible.configured) {
    warnings.push("Live LLM provider is not configured in the current environment.");
  }
  if (llmStatus.providers.openaiCompatible.secretSource === "env") {
    warnings.push("Live LLM provider key currently resolves from environment variables rather than the OS-backed secret store.");
  }
  if (llmStatus.providers.openaiCompatible.secretStoreStatus?.blockedByExecutionEnvironment) {
    warnings.push("OS-backed secret store status is unproven in the current execution environment.");
  }
  if (llmStatus.configIssues.length > 0) {
    warnings.push(...llmStatus.configIssues);
  }

  let promptRegistrySummary;
  try {
    const registry = await promptRegistryLoader();
    promptRegistrySummary = {
      status: "pass",
      environment: registry.environment,
      promptCount: registry.prompts.size
    };
  } catch (error) {
    promptRegistrySummary = {
      status: "fail",
      error: error.message
    };
    blocks.push(`Prompt registry failed to load: ${error.message}`);
  }

  let shellStatus;
  try {
    const operatorBaseUrl = assertLocalOperatorBaseUrl(env.COWORK_OPERATOR_BASE_URL || `http://127.0.0.1:${DEFAULT_OPERATOR_PORT}`);
    const browserCandidates = candidateBrowserPaths({ env });
    const availableBrowser = await resolveAvailableBrowserCandidate(browserCandidates);
    if (!availableBrowser) {
      warnings.push("No supported local shell browser was found for desktop:dev.");
    }
    shellStatus = {
      status: availableBrowser ? "pass" : "warn",
      operatorBaseUrl,
      browserCandidates,
      availableBrowser
    };
  } catch (error) {
    shellStatus = {
      status: "fail",
      error: error.message
    };
    blocks.push(`Desktop shell foundation invalid: ${error.message}`);
  }

  const latestValidationPackPath = path.join(validationRoot, "validation-pack-latest.json");
  const latestValidationPackExists = await fileExists(latestValidationPackPath);
  if (!latestValidationPackExists) {
    warnings.push("No bounded real-surface validation pack has been prepared yet.");
  }

  const validationStatus = {
    status: latestValidationPackExists ? "pass" : "warn",
    scenarioCount: getRealSurfaceScenarioCatalog().length,
    latestPackPath: latestValidationPackPath,
    latestPackExists: latestValidationPackExists
  };

  if (!evidence.tests.proven) {
    warnings.push("No passing persisted test report is available for the current build.");
  }
  if (evidence.secretStoreSmoke.status === "fail") {
    warnings.push("The latest OS secret-store smoke failed.");
  } else if (evidence.secretStoreSmoke.status === "missing") {
    warnings.push("No persisted OS secret-store smoke proof is available.");
  }
  if (!evidence.desktop.bundle.proven) {
    warnings.push("No passing desktop bundle proof is available.");
  }
  if (!evidence.desktop.smoke.proven) {
    warnings.push("No passing desktop shell smoke proof is available.");
  }
  if (!evidence.desktop.dryRun.proven) {
    warnings.push("No passing desktop shell dry-run proof is available.");
  }
  if (!evidence.llmSmoke.liveSuccess.proven) {
    warnings.push("No passing live-provider smoke proof is available.");
  }
  if (!evidence.llmSmoke.providerUnavailable.proven) {
    warnings.push("No passing provider-unavailable smoke proof is available.");
  }
  if (!evidence.llmSmoke.runtimeDegraded.proven) {
    warnings.push("No passing runtime-degraded smoke proof is available.");
  }

  return {
    generatedAt: new Date().toISOString(),
    status: blocks.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    checks: {
      llmRuntime: {
        status: llmStatus.providers.openaiCompatible.configured
          ? llmStatus.providers.openaiCompatible.secretSource === "os_secret_store" ? "pass" : "warn"
          : "warn",
        providerMode: llmStatus.providerMode,
        configIssues: llmStatus.configIssues,
        liveProviderConfigured: llmStatus.providers.openaiCompatible.configured,
        secretSource: llmStatus.providers.openaiCompatible.secretSource,
        secretStoreStatus: llmStatus.providers.openaiCompatible.secretStoreStatus,
        budgets: llmStatus.budgets
      },
      promptRegistry: promptRegistrySummary,
      desktopShellFoundation: shellStatus,
      realSurfaceHarness: validationStatus,
      proofArtifacts: {
        status: evidence.tests.proven && evidence.desktop.bundle.proven && evidence.desktop.smoke.proven
          ? "pass"
          : "warn",
        tests: evidence.tests,
        secretStoreSmoke: evidence.secretStoreSmoke,
        llmSmoke: evidence.llmSmoke,
        desktop: evidence.desktop,
        validationSummary: evidence.validationSummary
      },
      retentionPolicy: {
        status: "pass",
        defaultRetentionDays: DEFAULT_RUNTIME_RETENTION_DAYS
      }
    },
    warnings,
    blocks
  };
}
