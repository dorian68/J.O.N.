// Adaptive bandwidth governor for the remote-control screen stream.
//
// Observes each captured frame (bytes + transfer time), keeps a sliding-window
// average throughput, and selects a stable capture/update MODE. Designed to be:
//  - automatic: every frame feeds it, no manual setting;
//  - adaptive: low throughput → lower frequency/quality/volume; recovery → step up;
//  - stable: hysteresis (consecutive confirmations) prevents fast mode flapping;
//  - reactive: a brutal single-frame drop downgrades immediately.
//
// Output drives BOTH the client poll interval AND the server-side capture size
// (maxWidth) and JPEG quality, so the volume actually shrinks on poor links.

const MODES = [
  // Ordered best → worst. throughputFloorKbps = minimum sustained throughput to
  // hold this mode (used with hysteresis to step up/down).
  { name: "high",    intervalMs: 450,  maxWidth: 1920, quality: 72, throughputFloorKbps: 6000 },
  { name: "medium",  intervalMs: 900,  maxWidth: 1366, quality: 58, throughputFloorKbps: 2500 },
  { name: "low",     intervalMs: 1600, maxWidth: 1024, quality: 45, throughputFloorKbps: 900 },
  { name: "minimal", intervalMs: 3000, maxWidth: 768,  quality: 35, throughputFloorKbps: 0 }
];

function modeIndex(name) {
  const i = MODES.findIndex((m) => m.name === name);
  return i < 0 ? 1 : i;
}

export class BandwidthGovernor {
  constructor({ windowSize = 6, confirmations = 2, startMode = "medium" } = {}) {
    this.windowSize = Math.max(2, windowSize);
    this.confirmations = Math.max(1, confirmations);
    this.samples = []; // recent throughput in Kbps
    this.current = modeIndex(startMode);
    this._pendingDir = 0;   // +1 wants upgrade, -1 wants downgrade
    this._pendingCount = 0;
  }

  get mode() { return MODES[this.current]; }

  #avgKbps() {
    if (this.samples.length === 0) return 0;
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  // Record one frame; returns the selected strategy for the next frame.
  observe({ bytes = 0, durationMs = 1 } = {}) {
    const safeMs = Math.max(1, durationMs);
    const kbps = (bytes * 8) / safeMs; // bytes/ms*8 = kbits/s
    const prevAvg = this.#avgKbps();
    this.samples.push(kbps);
    if (this.samples.length > this.windowSize) this.samples.shift();
    const avg = this.#avgKbps();

    // Brutal drop: a single frame far below the running average → downgrade now.
    const brutalDrop = prevAvg > 0 && kbps < prevAvg * 0.4 && this.current < MODES.length - 1;
    if (brutalDrop) {
      this.current += 1;
      this._pendingDir = 0; this._pendingCount = 0;
      return this.#strategy("brutal_drop");
    }

    // Desired direction from sustained average vs the floors of neighbouring modes.
    let desired = this.current;
    // Downgrade if avg falls below the current mode's floor.
    if (avg < this.mode.throughputFloorKbps && this.current < MODES.length - 1) {
      desired = this.current + 1;
    } else if (this.current > 0) {
      // Upgrade only if avg comfortably clears the next-better mode's floor (margin).
      const better = MODES[this.current - 1];
      if (avg > better.throughputFloorKbps * 1.25) desired = this.current - 1;
    }

    if (desired === this.current) {
      this._pendingDir = 0; this._pendingCount = 0;
      return this.#strategy("stable");
    }

    const dir = desired > this.current ? -1 : 1; // -1 downgrade index up, +1 upgrade
    const wantDir = desired > this.current ? "down" : "up";
    if (this._pendingDir === (wantDir === "up" ? 1 : -1)) {
      this._pendingCount += 1;
    } else {
      this._pendingDir = wantDir === "up" ? 1 : -1;
      this._pendingCount = 1;
    }
    // Require N consecutive confirmations before switching (hysteresis).
    if (this._pendingCount >= this.confirmations) {
      this.current = desired;
      this._pendingDir = 0; this._pendingCount = 0;
      return this.#strategy(wantDir === "up" ? "upgrade" : "downgrade");
    }
    return this.#strategy("holding");
  }

  #strategy(transition) {
    const m = this.mode;
    return {
      mode: m.name,
      transition,
      throughputKbps: Math.round(this.#avgKbps()),
      recommendedIntervalMs: m.intervalMs,
      recommendedMaxWidth: m.maxWidth,
      recommendedQuality: m.quality
    };
  }

  snapshot() {
    return this.#strategy("snapshot");
  }
}
