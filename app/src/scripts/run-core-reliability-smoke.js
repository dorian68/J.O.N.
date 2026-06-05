// Core reliability smoke (audit Lot 3): single startMission (T7), browser launch
// URL flag-injection (T10), no double-actuation after dispatch timeout (T9),
// file path traversal / sensitive-path confinement (T11).
import { run } from "../../tests/core-reliability.test.js";

try {
  await run();
  console.log("✅ smoke:core-reliability PASS — T7 startMission, T9 no double-actuation, T10 URL sanitize, T11 path sandbox");
  process.exit(0);
} catch (error) {
  console.error("❌ smoke:core-reliability FAIL:", error.message);
  console.error(error.stack);
  process.exit(1);
}
