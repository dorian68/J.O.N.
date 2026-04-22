# Desktop Vision and Semantic Action Targeting V1

## Truth-first status

This repo now has a stronger desktop autonomy foundation, but it is not an unrestricted production-grade computer-use agent.

Implemented now:
- Windows app/window discovery through the local PowerShell provider.
- Window and full-screen capture primitives.
- UIAutomation accessibility tree extraction.
- Windows Media OCR extraction for captured screenshots when the local Windows OCR runtime is available.
- Normalized semantic targets for visible controls, including label, role, bounds, and click center.
- Semantic click resolution before pointer actuation when the plan names a visible UI target.
- Per-step safety assessment before local desktop actuation.
- Per-step checkpoints with before/after perception, safety decision, recovery state, and verification note.
- Basic recovery attempts: reinspection, prior-window refocus recommendation, active-window fallback, semantic target retry recommendation, and failure proof capture.
- Per-application skill catalog for browsers, text editors, file manager read-only observation, calculator, and generic apps.
- Packaging manifest now states desktop autonomy posture and production signing blockers.

Partially implemented now:
- Multi-window understanding is based on visible window inventory plus bounded accessibility summaries for the active and nearby windows.
- OCR is local Windows OCR, not a cross-platform or provider-vision stack. It is useful when Windows exposes OCR for the captured image, but accessibility remains the primary structured grounding source.
- Long planning is checkpointed per primitive, but the runtime still executes one bounded desktop run rather than a fully autonomous unlimited task loop.

Not implemented/proven:
- Arbitrary unrestricted control of the whole machine.
- Production-grade cross-app visual understanding.
- Reliable semantic targeting in apps that expose poor or no accessibility metadata.
- App-specific deep skills for every installed application.
- Signed native installer distribution.
- Real user testing evidence on long scenarios.

## Product boundary

The Cowork desktop agent may observe, plan, request approval, act through governed desktop primitives, verify, and capture proof. It must not silently take over the machine.

The runtime must keep:
- explicit approvals for app launch, typing, hotkeys, clicks, and scrolling;
- action evidence for every meaningful primitive;
- visible recovery state when a primitive fails;
- safety blocks for credentials, deletion, submission, installation, payment, publishing, and security bypass requests;
- a clear distinction between user-facing activity and operator diagnostics.

## Perception model

A desktop perception snapshot includes:
- active window;
- visible windows;
- accessibility tree when available;
- compact accessibility summary;
- semantic targets;
- screenshot/capture path when captured;
- OCR status.

The current primary structured text source is UIAutomation accessibility data. Screenshots are captured as proof and OCR input. Windows Media OCR is attempted on captured images and stored in vision snapshots when available.

## Semantic targeting

When the agent needs to click a visible control, it should prefer a semantic target:

```json
{
  "primitive": "click_point",
  "target": {
    "useActiveWindow": true,
    "semanticTarget": "Search",
    "role": "button"
  }
}
```

The executor resolves the semantic target against the current accessibility tree and clicks the target center only when a visible match is found. If no reliable match exists, the step fails with recovery evidence instead of guessing.

## Skills

The skill catalog is not a broad plugin framework. It is a safety and planning hint layer that describes:
- safe primitives for app families;
- blocked intents;
- verification strategy;
- recovery strategy.

Current skill families:
- browser basic navigation;
- text editor drafting;
- file manager read-only observation;
- calculator utility;
- generic desktop app.

## Recovery

Recovery is explicit and evidence-backed. The runtime records recovery attempts instead of hiding failures.

Current recovery strategies:
- reinspect current window;
- refocus prior window recommendation;
- active-window fallback;
- semantic target retry recommendation;
- capture failure proof.

## Production gap

This foundation is suitable for local pilot testing of bounded desktop actions. It is not production distribution-ready until these are proven:
- robust OCR/vision engine;
- app-specific skills for target user workflows;
- signed native installer;
- clean-machine validation;
- long scenario user testing;
- support and rollback procedure.
