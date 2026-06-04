// Temporal context resolver.
//
// JON's planner has no inherent notion of "today" — so a mission like "write
// tomorrow's showtimes" had no anchor date. This resolves relative date words
// into absolute dates and exposes them as planner context, so any mission with
// a time reference ("demain", "tomorrow", "ce week-end", "lundi prochain", …)
// is grounded. Generalizable: works for any mission, not a single case.

const REL_WORDS = /\b(aujourd['’]hui|today|demain|tomorrow|apr[èe]s-demain|day after tomorrow|hier|yesterday|ce soir|tonight|ce matin|cet apr[èe]s-midi|this (?:morning|afternoon|evening|weekend|week|month)|ce week-?end|cette semaine|ce mois|la semaine prochaine|next (?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|le mois prochain|maintenant|now|prochain|prochaine)\b/i;
const WEEKDAYS = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_NAMES_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

// True if the text references a relative or named date that needs grounding.
export function hasTemporalReference(text) {
  const str = String(text ?? "");
  return REL_WORDS.test(str) || WEEKDAYS.test(str);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// Builds the resolved date anchors. `now` is injectable for testing.
export function resolveTemporalContext(now = new Date()) {
  const today = new Date(now);
  const tomorrow = addDays(today, 1);
  const dayAfter = addDays(today, 2);
  const yesterday = addDays(today, -1);
  const dow = today.getDay();

  return {
    todayIso: isoDate(today),
    tomorrowIso: isoDate(tomorrow),
    dayAfterIso: isoDate(dayAfter),
    yesterdayIso: isoDate(yesterday),
    weekdayEn: WEEKDAY_NAMES[dow],
    weekdayFr: WEEKDAY_NAMES_FR[dow],
    nowIso: today.toISOString()
  };
}

// Planner-facing lines describing the current date so relative references can be
// resolved deterministically by the model.
export function buildTemporalContextLines(now = new Date()) {
  const t = resolveTemporalContext(now);
  return [
    "Temporal context (resolve any relative date in the objective against this):",
    `- Today / aujourd'hui: ${t.todayIso} (${t.weekdayEn} / ${t.weekdayFr})`,
    `- Tomorrow / demain: ${t.tomorrowIso}`,
    `- Day after tomorrow / après-demain: ${t.dayAfterIso}`,
    `- Yesterday / hier: ${t.yesterdayIso}`
  ];
}
