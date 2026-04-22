function indexById(items) {
  return new Map(items.map((item) => [item.id, item]));
}

export class RelationshipResolver {
  resolve(guidelines = []) {
    const byId = indexById(guidelines);
    const removed = new Set();
    const effects = [];

    for (const guideline of guidelines) {
      const dependsOn = guideline.relationships?.dependsOn ?? [];
      for (const dependencyId of dependsOn) {
        if (!byId.has(dependencyId)) {
          removed.add(guideline.id);
          effects.push({
            type: "dependency_missing",
            guidelineId: guideline.id,
            dependencyId,
            reason: `Guideline ${guideline.id} depends on ${dependencyId}, which is not active.`
          });
        }
      }
    }

    const active = guidelines.filter((guideline) => !removed.has(guideline.id));
    const activeById = indexById(active);

    for (const guideline of active) {
      const overrides = guideline.relationships?.overrides ?? [];
      for (const targetId of overrides) {
        if (!activeById.has(targetId) || removed.has(targetId)) {
          continue;
        }
        removed.add(targetId);
        effects.push({
          type: "override_applied",
          guidelineId: guideline.id,
          targetId,
          reason: `Guideline ${guideline.id} overrides ${targetId}.`
        });
      }
    }

    const remaining = active.filter((guideline) => !removed.has(guideline.id));
    const remainingById = indexById(remaining);

    for (const guideline of [...remaining].sort((left, right) => right.priority - left.priority)) {
      const exclusions = guideline.relationships?.excludes ?? [];
      for (const targetId of exclusions) {
        const target = remainingById.get(targetId);
        if (!target || removed.has(targetId)) {
          continue;
        }
        const winningGuideline = guideline.priority >= target.priority ? guideline : target;
        const losingGuideline = winningGuideline.id === guideline.id ? target : guideline;
        removed.add(losingGuideline.id);
        effects.push({
          type: "exclusion_resolved",
          guidelineId: winningGuideline.id,
          targetId: losingGuideline.id,
          reason: `Guideline ${winningGuideline.id} excludes ${losingGuideline.id} due to higher or equal priority.`
        });
      }
    }

    return {
      guidelines: remaining.filter((guideline) => !removed.has(guideline.id)),
      effects
    };
  }
}

export function createDefaultRelationshipResolver() {
  return new RelationshipResolver();
}
