// Security smoke (audit Lot 1): secure bind default, central auth gate, MCP stdio
// gating, redaction, production readiness. Backend-first, no UI needed.
import { run } from "../../tests/security.test.js";

try {
  await run();
  console.log("✅ smoke:security PASS — bind/auth, MCP stdio gate, redaction, production readiness");
  process.exit(0);
} catch (error) {
  console.error("❌ smoke:security FAIL:", error.message);
  console.error(error.stack);
  process.exit(1);
}
