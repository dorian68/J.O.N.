import assert from "node:assert/strict";
import { BandwidthGovernor } from "../src/mobile/bandwidth-governor.js";

// Helper: feed a frame with a target throughput (Kbps) → choose bytes for 100ms.
function frame(kbps) {
  const durationMs = 100;
  const bytes = (kbps * durationMs) / 8; // kbps * ms / 8 = bytes
  return { bytes, durationMs };
}

export async function run() {
  const gov = new BandwidthGovernor({ windowSize: 4, confirmations: 2, startMode: "medium" });
  assert.equal(gov.mode.name, "medium");

  // Sustained low throughput → should downgrade (after hysteresis confirmations).
  let last;
  for (let i = 0; i < 5; i += 1) last = gov.observe(frame(300)); // below low floor too
  assert.ok(["low", "minimal"].includes(last.mode), `downgraded under low bw, got ${last.mode}`);
  assert.ok(last.recommendedIntervalMs >= 1500, "interval increased on low bw");
  assert.ok(last.recommendedMaxWidth <= 1024, "capture width reduced on low bw");

  // Sustained high throughput → should step back up (gradually, with hysteresis).
  for (let i = 0; i < 8; i += 1) last = gov.observe(frame(12000));
  assert.ok(["high", "medium"].includes(last.mode), `upgraded under high bw, got ${last.mode}`);

  // Hysteresis: a single good frame should NOT immediately jump modes.
  const gov2 = new BandwidthGovernor({ windowSize: 6, confirmations: 3, startMode: "low" });
  const after1 = gov2.observe(frame(12000));
  assert.equal(after1.mode, "low", "one good frame does not flip mode (hysteresis)");

  // Brutal drop: from a healthy average, a single tiny frame downgrades now.
  const gov3 = new BandwidthGovernor({ windowSize: 6, confirmations: 3, startMode: "high" });
  for (let i = 0; i < 4; i += 1) gov3.observe(frame(9000));
  const dropped = gov3.observe(frame(200)); // ~2% of avg
  assert.equal(dropped.transition, "brutal_drop");
  assert.notEqual(dropped.mode, "high", "brutal drop downgraded immediately");

  // Snapshot reports a usable strategy.
  const snap = gov.snapshot();
  assert.ok(snap.recommendedIntervalMs > 0 && snap.recommendedMaxWidth > 0 && snap.recommendedQuality > 0);
}
