import {
  BUILTIN_SKILL_MANIFESTS,
  SKILL_DEPTH,
  SKILL_IMPLEMENTATION_STATUS,
  validateSkillManifest
} from "./skill-manifest.js";

const REQUIRED_DEEP_FIELDS = Object.freeze([
  "supportedWorkflows",
  "stateDetectors",
  "semanticTargets",
  "verifiers",
  "recoveryStrategies",
  "evidenceRequirements"
]);

function fieldPasses(skill, field) {
  return Array.isArray(skill[field]) && skill[field].length > 0;
}

function workflowResult(skill, workflow = {}) {
  const missingPrimitives = (workflow.requiredPrimitives ?? []).filter((primitive) => !(skill.primitives ?? []).includes(primitive));
  const missingCriteria = !Array.isArray(workflow.successCriteria) || workflow.successCriteria.length === 0;
  return {
    id: workflow.id ?? "unknown_workflow",
    label: workflow.label ?? workflow.id ?? "Unknown workflow",
    requiredPrimitives: workflow.requiredPrimitives ?? [],
    pass: missingPrimitives.length === 0 && !missingCriteria,
    missingPrimitives,
    missingCriteria
  };
}

export function validateOperationalDeepSkill(skill = {}) {
  const manifestValidation = validateSkillManifest(skill);
  const fieldChecks = REQUIRED_DEEP_FIELDS.map((field) => ({
    field,
    pass: fieldPasses(skill, field),
    count: Array.isArray(skill[field]) ? skill[field].length : 0
  }));
  const workflows = (skill.supportedWorkflows ?? []).map((workflow) => workflowResult(skill, workflow));
  const policyPass = Array.isArray(skill.policyHooks) && skill.policyHooks.length > 0;
  const evidencePass = Array.isArray(skill.evidenceHooks) && skill.evidenceHooks.length > 0;
  const verifierPass = Array.isArray(skill.verifiers) && skill.verifiers.length > 0;
  const recoveryPass = Array.isArray(skill.recoveryStrategies) && skill.recoveryStrategies.length > 0;
  const deepDeclared = skill.implementationStatus === SKILL_IMPLEMENTATION_STATUS.OPERATIONAL_DEEP
    && skill.capabilityDepth === SKILL_DEPTH.OPERATIONAL_DEEP;
  const pass = manifestValidation.valid
    && deepDeclared
    && fieldChecks.every((check) => check.pass)
    && workflows.length > 0
    && workflows.every((workflow) => workflow.pass)
    && policyPass
    && evidencePass
    && verifierPass
    && recoveryPass;
  const checks = [
    { id: "manifest_schema", pass: manifestValidation.valid, errors: manifestValidation.errors },
    { id: "deep_status", pass: deepDeclared },
    { id: "policy_hooks", pass: policyPass, count: skill.policyHooks?.length ?? 0 },
    { id: "evidence_hooks", pass: evidencePass, count: skill.evidenceHooks?.length ?? 0 },
    { id: "verifiers", pass: verifierPass, count: skill.verifiers?.length ?? 0 },
    { id: "recovery", pass: recoveryPass, count: skill.recoveryStrategies?.length ?? 0 },
    ...fieldChecks.map((check) => ({ id: `field.${check.field}`, ...check })),
    ...workflows.map((workflow) => ({ id: `workflow.${workflow.id}`, ...workflow }))
  ];
  return {
    skillId: skill.id,
    label: skill.label,
    status: pass ? "pass" : "fail",
    pass,
    proofLevel: "repo_contract_validated",
    productionProof: "requires_real_scenario_evidence",
    workflowCount: workflows.length,
    verifierCount: skill.verifiers?.length ?? 0,
    recoveryStrategyCount: skill.recoveryStrategies?.length ?? 0,
    evidenceRequirementCount: skill.evidenceRequirements?.length ?? 0,
    checks,
    limitations: [
      "This validation proves the deep skill contract in-repo.",
      "It is not a substitute for long real-user desktop validation on target machines."
    ]
  };
}

export function validateOperationalDeepSkills(skills = BUILTIN_SKILL_MANIFESTS) {
  const results = skills.map(validateOperationalDeepSkill);
  const passed = results.filter((result) => result.pass).length;
  return {
    status: passed === results.length ? "all_passed" : "partial",
    skillCount: results.length,
    passed,
    failed: results.length - passed,
    proofLevel: "repo_contract_validated",
    productionProof: "requires_real_scenario_evidence",
    results
  };
}
