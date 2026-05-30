const FORBIDDEN_APPROACHES = new Set([
  "captcha_bypass",
  "anti_bot_bypass",
  "credential_extraction",
  "credential_theft",
  "stealth_bypass",
  "payment_automation",
  "session_hijack",
  "aggressive_scraping",
  "data_exfiltration"
]);

const FORBIDDEN_ID_PATTERNS = [
  /captcha.*bypass|bypass.*captcha/i,
  /anti.?bot.*bypass|bypass.*anti.?bot/i,
  /steal.*credential|harvest.*credential/i,
  /automate.*payment/i,
  /inject.*script/i,
  /headless.*spoof/i
];

export function filterByPolicy(alternatives) {
  return alternatives.filter(alt => getPolicyViolationReason(alt) === null);
}

export function getPolicyViolationReason(alt) {
  if (FORBIDDEN_APPROACHES.has(alt.approach)) {
    return `Forbidden approach: ${alt.approach}`;
  }
  if (alt.safetyLevel === "forbidden") {
    return "Alternative marked as forbidden by policy.";
  }
  for (const p of FORBIDDEN_ID_PATTERNS) {
    if (p.test(alt.id ?? "") || p.test(alt.description ?? "")) {
      return `Violates policy pattern: ${p.source}`;
    }
  }
  return null;
}
