import { createId, nowIso } from "../utils/ids.js";

export function createEvent(eventType, actor, summary, payload = {}) {
  return {
    id: createId("evt"),
    type: eventType,
    actor,
    summary,
    payload,
    createdAt: nowIso()
  };
}
