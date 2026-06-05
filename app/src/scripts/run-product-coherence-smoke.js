// Product coherence smoke (audit Lot 4): MCP catalog honesty (F2) + desktop
// run-artifacts wiring (F1).
import { run } from "../../tests/product-coherence.test.js";

try {
  await run();
  console.log("✅ smoke:product PASS — MCP catalog honest (available vs coming_soon), desktop artifacts wired");
  process.exit(0);
} catch (error) {
  console.error("❌ smoke:product FAIL:", error.message);
  console.error(error.stack);
  process.exit(1);
}
