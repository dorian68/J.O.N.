import assert from "node:assert/strict";
import { hasTemporalReference, resolveTemporalContext, buildTemporalContextLines } from "../src/mission/temporal-context.js";

export async function run() {
  // Detection
  assert.equal(hasTemporalReference("écris les séances de demain"), true);
  assert.equal(hasTemporalReference("write tomorrow's showtimes"), true);
  assert.equal(hasTemporalReference("réunion lundi prochain"), true);
  assert.equal(hasTemporalReference("compare les pages candidates"), false);

  // Resolution against a fixed clock (deterministic).
  const fixed = new Date("2026-06-04T10:00:00Z"); // Thursday
  const ctx = resolveTemporalContext(fixed);
  assert.equal(ctx.todayIso, "2026-06-04");
  assert.equal(ctx.tomorrowIso, "2026-06-05");
  assert.equal(ctx.dayAfterIso, "2026-06-06");
  assert.equal(ctx.yesterdayIso, "2026-06-03");
  assert.equal(ctx.weekdayEn, "Thursday");

  const lines = buildTemporalContextLines(fixed);
  assert.ok(lines.some((l) => l.includes("2026-06-05")), "tomorrow date present in planner lines");
  assert.ok(lines[0].toLowerCase().includes("temporal context"));
}
