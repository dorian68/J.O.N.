import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixtureServer } from "../fixtures/fixture-server.js";
import { createPrototypeRuntime } from "../runtime/create-prototype-runtime.js";
import { APPROVAL_DECISION } from "../config.js";
import { BrowserController } from "../browser/browser-controller.js";

async function tempDbPath(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  return path.join(dir, "prototype.sqlite");
}

export async function runBrowserBenchmarks() {
  const fixtureServer = await createFixtureServer();
  const dbPath = await tempDbPath("cowork-browser");
  const denyDbPath = await tempDbPath("cowork-browser-deny");
  const runtimeHandle = await createPrototypeRuntime({
    dbPath,
    browserOptions: {
      headless: true
    },
    approvalResolver: async (request) => ({
      decision: APPROVAL_DECISION.APPROVED_ONCE,
      rationale: `Controlled browser benchmark approval for ${request.actionLabel}.`
    })
  });
  const deniedRuntimeHandle = await createPrototypeRuntime({
    dbPath: denyDbPath,
    browserOptions: {
      headless: true
    },
    approvalResolver: async (request) => ({
      decision: APPROVAL_DECISION.DENIED,
      rationale: `Controlled refusal benchmark denial for ${request.actionLabel}.`
    })
  });
  const primitiveBrowser = new BrowserController({
    headless: true
  });

  try {
    const project = runtimeHandle.runtime.createProject({
      name: "Controlled browser benchmarks",
      description: "Controlled benchmark project",
      allowlistedDomains: ["127.0.0.1"]
    });

    const researchResult = await runtimeHandle.runtime.runResearchMission({
      projectId: project.id,
      mission: "Compare the controlled candidate pages and propose the best fit.",
      hubUrl: fixtureServer.manifest.hub,
      linkSpecs: [
        { testId: "link-alpha", title: "Alpha Analytics" },
        { testId: "link-beta", title: "Beta Commerce" },
        { testId: "link-gamma", title: "Gamma Ops" }
      ],
      fieldMap: {
        companyName: { testId: "company-name" },
        tagline: { testId: "company-tagline" },
        priceLevel: { testId: "price-level" },
        deliverySpeed: { testId: "delivery-speed" },
        riskNote: { testId: "risk-note" }
      }
    });
    const collectionArtifact = researchResult.artifacts.find((artifact) => artifact.artifactType === "tableau_collecte_navigateur");
    const decisionArtifact = researchResult.artifacts.find((artifact) => artifact.artifactType === "note_de_decision");
    const collectionArtifactContent = collectionArtifact
      ? await fs.readFile(collectionArtifact.storagePath, "utf8")
      : "";
    const decisionArtifactContent = decisionArtifact
      ? await fs.readFile(decisionArtifact.storagePath, "utf8")
      : "";

    const formResult = await runtimeHandle.runtime.runFormPreparationMission({
      projectId: project.id,
      mission: "Prepare the controlled form without submission.",
      formUrl: fixtureServer.manifest.form,
      values: {
        name: "Jordan Labry",
        role: "operator",
        subscribe: false
      }
    });

    const deniedProject = deniedRuntimeHandle.runtime.createProject({
      name: "Controlled refusal browser benchmarks",
      description: "Controlled benchmark project for denied write-intent flow",
      allowlistedDomains: ["127.0.0.1"]
    });

    const deniedFormResult = await deniedRuntimeHandle.runtime.runFormPreparationMission({
      projectId: deniedProject.id,
      mission: "Attempt the controlled form with an explicit approval denial.",
      formUrl: fixtureServer.manifest.form,
      values: {
        name: "Jordan Labry",
        role: "operator",
        subscribe: false
      }
    });
    const deniedRunEventTypes = deniedFormResult.events.map((event) => event.type);
    const deniedApproval = deniedFormResult.approvals[0] ?? null;

    await primitiveBrowser.openBrowserSession({
      allowlistedHosts: ["127.0.0.1"]
    });
    const primitiveTarget = primitiveBrowser.focusTab(primitiveBrowser.activeTargetId ?? primitiveBrowser.listTargets()[0].id);

    await primitiveBrowser.navigate(primitiveTarget, fixtureServer.manifest.longScroll);
    await primitiveBrowser.waitForPageState(primitiveTarget, {
      selector: { text: "Long page" }
    });
    for (let index = 0; index < 4; index += 1) {
      await primitiveBrowser.scrollViewport(primitiveTarget, { deltaY: 900 });
    }
    const deepTargetInspection = await primitiveBrowser.inspectElement(primitiveTarget, { testId: "deep-target" });

    await primitiveBrowser.navigate(primitiveTarget, fixtureServer.manifest.ambiguous);
    const ambiguousRanking = await primitiveBrowser.queryDom(primitiveTarget, {
      role: "button",
      name: "Review profile"
    });

    await primitiveBrowser.navigate(primitiveTarget, fixtureServer.manifest.modal);
    const blockerBefore = await primitiveBrowser.detectBlockers(primitiveTarget);
    await primitiveBrowser.handleModal(primitiveTarget, { testId: "button-dismiss-modal" });
    const blockerAfter = await primitiveBrowser.detectBlockers(primitiveTarget);
    const modalDismissed = await primitiveBrowser.verifyOutcome(primitiveTarget, {
      type: "text_visible",
      selector: { testId: "modal-status" },
      expectedText: "dismissed"
    });

    await primitiveBrowser.navigate(primitiveTarget, fixtureServer.manifest.outcome);
    await primitiveBrowser.clickElement(primitiveTarget, { testId: "button-promote-status" });
    const outcomeValidated = await primitiveBrowser.verifyOutcome(primitiveTarget, {
      type: "text_visible",
      selector: { testId: "status-value" },
      expectedText: "ready"
    });

    const assertions = {
      researchCompleted: researchResult.run.status === "completed",
      researchArtifactCount: researchResult.artifacts.length === 2,
      researchSourceCount: researchResult.sources.length === 3,
      collectionArtifactTraceable: collectionArtifactContent.includes("Source ref") && collectionArtifactContent.includes("Validation status"),
      decisionArtifactQualified: decisionArtifactContent.includes("# Confidence") && decisionArtifactContent.includes("# Validation status"),
      formCompleted: formResult.run.status === "completed",
      formApprovalCount: formResult.approvals.length >= 2,
      formEvidenceCount: formResult.evidence.length >= 1,
      refusalRunStopped: deniedFormResult.run.status === "stopped",
      refusalApprovalDenied: deniedApproval?.decision === APPROVAL_DECISION.DENIED,
      refusalNoImplicitWrite: deniedFormResult.evidence.length === 1 && deniedFormResult.artifacts.length === 0,
      refusalEventTracked: deniedRunEventTypes.includes("approval.denied") && deniedRunEventTypes.includes("run.stopped"),
      deepScrollResolved: deepTargetInspection.found === true,
      ambiguousDomDetected: ambiguousRanking.ambiguous === true,
      blockerDetected: blockerBefore.blocked === true,
      blockerDismissed: blockerAfter.blocked === false && modalDismissed.validated === true,
      outcomeVerified: outcomeValidated.validated === true
    };

    const assertionDetails = {
      researchCompleted: {
        label: "Research run completed",
        expected: "run status completed",
        observed: researchResult.run.status,
        reason: researchResult.run.status === "completed"
          ? "Research run completed successfully."
          : `Research run ended with status ${researchResult.run.status}.`,
        refs: { runId: researchResult.run.id }
      },
      researchArtifactCount: {
        label: "Research artifacts created",
        expected: "2 artifacts",
        observed: researchResult.artifacts.length,
        reason: researchResult.artifacts.length === 2
          ? "Both MVP artifacts were created."
          : `Expected 2 artifacts, observed ${researchResult.artifacts.length}.`,
        refs: {
          runId: researchResult.run.id,
          artifactIds: researchResult.artifacts.map((artifact) => artifact.id)
        }
      },
      researchSourceCount: {
        label: "Research sources collected",
        expected: "3 sources",
        observed: researchResult.sources.length,
        reason: researchResult.sources.length === 3
          ? "Three controlled sources were collected."
          : `Expected 3 sources, observed ${researchResult.sources.length}.`,
        refs: {
          runId: researchResult.run.id,
          sourceIds: researchResult.sources.map((source) => source.id)
        }
      },
      collectionArtifactTraceable: {
        label: "Collection artifact is traceable",
        expected: "collection artifact renders source ref and validation status",
        observed: {
          hasSourceRef: collectionArtifactContent.includes("Source ref"),
          hasValidationStatus: collectionArtifactContent.includes("Validation status")
        },
        reason: collectionArtifactContent.includes("Source ref") && collectionArtifactContent.includes("Validation status")
          ? "Collection artifact renders the key traceability fields."
          : "Collection artifact is missing at least one required traceability field.",
        refs: {
          runId: researchResult.run.id,
          artifactIds: collectionArtifact ? [collectionArtifact.id] : []
        }
      },
      decisionArtifactQualified: {
        label: "Decision artifact exposes confidence and validation",
        expected: "decision note includes confidence and validation status sections",
        observed: {
          hasConfidence: decisionArtifactContent.includes("# Confidence"),
          hasValidationStatus: decisionArtifactContent.includes("# Validation status")
        },
        reason: decisionArtifactContent.includes("# Confidence") && decisionArtifactContent.includes("# Validation status")
          ? "Decision note exposes confidence and validation state."
          : "Decision note is missing confidence or validation state.",
        refs: {
          runId: researchResult.run.id,
          artifactIds: decisionArtifact ? [decisionArtifact.id] : []
        }
      },
      formCompleted: {
        label: "Form preparation completed",
        expected: "run status completed",
        observed: formResult.run.status,
        reason: formResult.run.status === "completed"
          ? "Form preparation completed before submission."
          : `Form run ended with status ${formResult.run.status}.`,
        refs: { runId: formResult.run.id }
      },
      formApprovalCount: {
        label: "Form approvals captured",
        expected: "at least 2 approvals",
        observed: formResult.approvals.length,
        reason: formResult.approvals.length >= 2
          ? "The expected bounded edit approvals were recorded."
          : `Expected at least 2 approvals, observed ${formResult.approvals.length}.`,
        refs: {
          runId: formResult.run.id,
          approvalIds: formResult.approvals.map((approval) => approval.id)
        }
      },
      formEvidenceCount: {
        label: "Form evidence captured",
        expected: "at least 1 evidence record",
        observed: formResult.evidence.length,
        reason: formResult.evidence.length >= 1
          ? "Form evidence was persisted."
          : "No form evidence was persisted.",
        refs: {
          runId: formResult.run.id,
          evidenceIds: formResult.evidence.map((entry) => entry.id)
        }
      },
      refusalRunStopped: {
        label: "Refusal flow stops the run cleanly",
        expected: "run status stopped",
        observed: deniedFormResult.run.status,
        reason: deniedFormResult.run.status === "stopped"
          ? "Denied approval produced a clean stopped run."
          : `Denied form run ended with status ${deniedFormResult.run.status}.`,
        refs: { runId: deniedFormResult.run.id }
      },
      refusalApprovalDenied: {
        label: "Approval denial recorded explicitly",
        expected: "first approval decision denied",
        observed: deniedApproval?.decision ?? null,
        reason: deniedApproval?.decision === APPROVAL_DECISION.DENIED
          ? "Approval denial was recorded explicitly."
          : "Expected a denied approval record for the refusal benchmark.",
        refs: {
          runId: deniedFormResult.run.id,
          approvalIds: deniedFormResult.approvals.map((approval) => approval.id)
        }
      },
      refusalNoImplicitWrite: {
        label: "Refusal path avoids implicit write effects",
        expected: "only pre-approval evidence and no artifact",
        observed: {
          evidenceCount: deniedFormResult.evidence.length,
          artifactCount: deniedFormResult.artifacts.length
        },
        reason: deniedFormResult.evidence.length === 1 && deniedFormResult.artifacts.length === 0
          ? "The refusal path stopped before producing post-edit evidence or artifacts."
          : "The refusal path produced unexpected evidence or artifact side effects.",
        refs: {
          runId: deniedFormResult.run.id,
          evidenceIds: deniedFormResult.evidence.map((entry) => entry.id)
        }
      },
      refusalEventTracked: {
        label: "Refusal path remains traceable",
        expected: "approval.denied and run.stopped events",
        observed: deniedRunEventTypes,
        reason: deniedRunEventTypes.includes("approval.denied") && deniedRunEventTypes.includes("run.stopped")
          ? "Refusal path events were recorded."
          : "Denied approval path did not leave the expected event trail.",
        refs: { runId: deniedFormResult.run.id }
      },
      deepScrollResolved: {
        label: "Deep scroll target resolved",
        expected: "deep target found after viewport scroll",
        observed: deepTargetInspection.found,
        reason: deepTargetInspection.found === true
          ? "The deep target remained discoverable after repeated scroll steps."
          : "The deep target was not found after repeated scroll steps."
      },
      ambiguousDomDetected: {
        label: "Ambiguous DOM detected",
        expected: "ambiguous candidate ranking",
        observed: ambiguousRanking.ambiguous,
        reason: ambiguousRanking.ambiguous === true
          ? "The DOM strategy marked the target set as ambiguous."
          : "The DOM strategy did not report ambiguity where expected."
      },
      blockerDetected: {
        label: "Modal blocker detected",
        expected: "blocked=true before dismissal",
        observed: blockerBefore.blocked,
        reason: blockerBefore.blocked === true
          ? "The modal blocker was detected before dismissal."
          : "Expected a modal blocker before dismissal."
      },
      blockerDismissed: {
        label: "Modal blocker dismissed",
        expected: "blocked=false after dismissal and visible status dismissed",
        observed: {
          blockedAfter: blockerAfter.blocked,
          statusValidated: modalDismissed.validated
        },
        reason: blockerAfter.blocked === false && modalDismissed.validated === true
          ? "The modal blocker was dismissed cleanly."
          : "Modal dismissal did not produce the expected unblocked state."
      },
      outcomeVerified: {
        label: "Outcome verification succeeded",
        expected: "status-value contains ready",
        observed: outcomeValidated.observed,
        reason: outcomeValidated.validated === true
          ? "Outcome verification confirmed the expected state."
          : "Outcome verification did not confirm the expected state."
      }
    };

    return {
      fixtureBaseUrl: fixtureServer.baseUrl,
      researchRunId: researchResult.run.id,
      formRunId: formResult.run.id,
      researchArtifacts: researchResult.artifacts,
      researchSources: researchResult.sources,
      researchEvidence: researchResult.evidence,
      formEvidence: formResult.evidence,
      formApprovals: formResult.approvals,
      deniedFormRunId: deniedFormResult.run.id,
      deniedFormEvidence: deniedFormResult.evidence,
      deniedFormApprovals: deniedFormResult.approvals,
      primitiveChecks: {
        deepTargetInspection,
        ambiguousRanking: {
          ambiguous: ambiguousRanking.ambiguous,
          best: ambiguousRanking.best
        },
        blockerBefore,
        blockerAfter,
        modalDismissed,
        outcomeValidated
      },
      assertions,
      assertionDetails,
      cases: [
        {
          id: "research-flow",
          label: "Research mission flow",
          summary: "Controlled multi-page read flow with artifact generation.",
          relatedRunId: researchResult.run.id,
          relatedSourceIds: researchResult.sources.map((source) => source.id),
          relatedEvidenceIds: researchResult.evidence.map((entry) => entry.id),
          relatedArtifactIds: researchResult.artifacts.map((artifact) => artifact.id),
          assertions: {
            researchCompleted: assertions.researchCompleted,
            researchArtifactCount: assertions.researchArtifactCount,
            researchSourceCount: assertions.researchSourceCount,
            collectionArtifactTraceable: assertions.collectionArtifactTraceable,
            decisionArtifactQualified: assertions.decisionArtifactQualified
          },
          assertionDetails
        },
        {
          id: "form-flow",
          label: "Form preparation flow",
          summary: "Controlled bounded-edit flow with explicit approvals and no submission.",
          relatedRunId: formResult.run.id,
          relatedEvidenceIds: formResult.evidence.map((entry) => entry.id),
          assertions: {
            formCompleted: assertions.formCompleted,
            formApprovalCount: assertions.formApprovalCount,
            formEvidenceCount: assertions.formEvidenceCount
          },
          assertionDetails
        },
        {
          id: "refusal-flow",
          label: "Refusal and clean stop flow",
          summary: "Controlled approval denial with explicit stop, traceability and no implicit write effect.",
          relatedRunId: deniedFormResult.run.id,
          relatedEvidenceIds: deniedFormResult.evidence.map((entry) => entry.id),
          assertions: {
            refusalRunStopped: assertions.refusalRunStopped,
            refusalApprovalDenied: assertions.refusalApprovalDenied,
            refusalNoImplicitWrite: assertions.refusalNoImplicitWrite,
            refusalEventTracked: assertions.refusalEventTracked
          },
          assertionDetails
        },
        {
          id: "dom-primitives",
          label: "DOM-first primitives",
          summary: "Viewport scroll, ambiguity handling, blockers and outcome verification.",
          assertions: {
            deepScrollResolved: assertions.deepScrollResolved,
            ambiguousDomDetected: assertions.ambiguousDomDetected,
            blockerDetected: assertions.blockerDetected,
            blockerDismissed: assertions.blockerDismissed,
            outcomeVerified: assertions.outcomeVerified
          },
          assertionDetails
        }
      ]
    };
  } finally {
    await primitiveBrowser.close().catch(() => {});
    await runtimeHandle.close();
    await deniedRuntimeHandle.close();
    await fixtureServer.close();
  }
}
