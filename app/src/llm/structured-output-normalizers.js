function assertStructuredStringArray(value, label) {
  if (!Array.isArray(value)) {
    throw Object.assign(new Error(`${label} must be an array.`), {
      category: "malformed_output"
    });
  }
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

function coerceStructuredStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (entry && typeof entry === "object") {
        return String(entry.step ?? entry.title ?? entry.action ?? entry.description ?? entry.summary ?? "").trim();
      }
      return String(entry ?? "").trim();
    }).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(/\r?\n|(?:^|\s)\d+[.)]\s+/).map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function normalizePlanEntries(planEntries) {
  if (!Array.isArray(planEntries)) {
    return null;
  }

  const steps = [];
  const assumptions = [];

  for (const entry of planEntries) {
    if (typeof entry === "string") {
      const text = entry.trim();
      if (text) {
        steps.push(text);
      }
      continue;
    }
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const title = String(entry.step ?? entry.title ?? entry.action ?? entry.summary ?? "").trim();
    const description = String(entry.description ?? entry.detail ?? entry.rationale ?? "").trim();
    const stepText = [title, description].filter(Boolean).join(": ");
    if (stepText) {
      steps.push(stepText);
    }
    if (Array.isArray(entry.assumptions)) {
      assumptions.push(...entry.assumptions.map((item) => String(item ?? "").trim()).filter(Boolean));
    }
  }

  if (steps.length === 0) {
    return null;
  }

  return {
    steps,
    assumptions
  };
}

export function normalizePlanOutput(output) {
  if (!output || typeof output !== "object") {
    throw Object.assign(new Error("Plan generation output must be an object."), {
      category: "malformed_output"
    });
  }

  if (Array.isArray(output.steps)) {
    const steps = assertStructuredStringArray(output.steps, "steps");
    if (steps.length === 0) {
      throw Object.assign(new Error("Plan generation output must contain at least one step."), {
        category: "malformed_output"
      });
    }
    return {
      steps,
      assumptions: assertStructuredStringArray(output.assumptions ?? [], "assumptions")
    };
  }

  const planCandidates = [
    output.plan,
    output.actions,
    output.tasks,
    output.runNowPlan,
    output.executionPlan,
    output.plan?.steps,
    output.runPlan?.steps
  ];
  const normalizedPlan = planCandidates.map(normalizePlanEntries).find(Boolean);
  if (normalizedPlan) {
    const topLevelAssumptions = Array.isArray(output.assumptions)
      ? output.assumptions.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [];
    return {
      steps: normalizedPlan.steps,
      assumptions: [...normalizedPlan.assumptions, ...topLevelAssumptions]
    };
  }

  const coercedSteps = coerceStructuredStringArray(output.runNowPlan ?? output.actions ?? output.tasks ?? output.executionPlan);
  if (coercedSteps.length > 0) {
    return {
      steps: coercedSteps,
      assumptions: coerceStructuredStringArray(output.assumptions)
    };
  }

  throw Object.assign(new Error("Plan generation output must contain non-empty steps."), {
    category: "malformed_output"
  });
}
