// Browser extension smoke (audit Lot 2): packaging (validate + zip) + eval/CDP
// gating (T3). The bridge spoofing protections (T4) are covered by the
// browser-extension-bridge test suite.
import { run } from "../../tests/browser-extension-package.test.js";

try {
  await run();
  console.log("✅ smoke:browser-extension PASS — extension packages to a valid zip; eval/CDP gated by default");
  process.exit(0);
} catch (error) {
  console.error("❌ smoke:browser-extension FAIL:", error.message);
  console.error(error.stack);
  process.exit(1);
}
