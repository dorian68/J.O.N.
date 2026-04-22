function normalizeText(value) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export async function captureDomSnapshot(page) {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    const interactiveSelector = [
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
      "[role='button']",
      "[role='link']"
    ].join(", ");

    const interactiveElements = Array.from(document.querySelectorAll(interactiveSelector)).slice(0, 50).map((element) => ({
      tagName: element.tagName.toLowerCase(),
      text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim(),
      role: element.getAttribute("role"),
      label: element.getAttribute("aria-label"),
      testId: element.getAttribute("data-testid"),
      id: element.id || null,
      disabled: element.hasAttribute("disabled"),
      hidden: element.getAttribute("aria-hidden") === "true" || element.hidden
    }));

    return {
      title: document.title,
      url: window.location.href,
      bodyText: (main?.innerText || document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 5000),
      interactiveElements
    };
  });
}

export async function listInteractiveElements(page) {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("a[href], button, input, select, textarea, [role='button'], [role='link']"));
    return candidates.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const labelElement = element.id ? document.querySelector(`label[for="${element.id}"]`) : null;
      const style = window.getComputedStyle(element);
      return {
        index,
        tagName: element.tagName.toLowerCase(),
        text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim(),
        role: element.getAttribute("role"),
        ariaLabel: element.getAttribute("aria-label"),
        label: labelElement?.innerText?.replace(/\s+/g, " ").trim() || null,
        testId: element.getAttribute("data-testid"),
        id: element.id || null,
        type: element.getAttribute("type"),
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
        disabled: element.hasAttribute("disabled"),
        outsideViewport: rect.bottom < 0 || rect.top > window.innerHeight,
        center: {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2)
        }
      };
    });
  });
}

export function rankCandidates(candidates, selectorSpec = {}) {
  const ranked = candidates.map((candidate) => {
    let score = 0;
    const reasons = [];

    if (selectorSpec.testId && candidate.testId === selectorSpec.testId) {
      score += 100;
      reasons.push("testId");
    }
    if (selectorSpec.role && candidate.role === selectorSpec.role) {
      score += 60;
      reasons.push("role");
    }
    if (selectorSpec.label && normalizeText(candidate.label).toLowerCase() === normalizeText(selectorSpec.label).toLowerCase()) {
      score += 50;
      reasons.push("label");
    }
    if (selectorSpec.name && normalizeText(candidate.text).toLowerCase().includes(normalizeText(selectorSpec.name).toLowerCase())) {
      score += 40;
      reasons.push("name");
    }
    if (selectorSpec.text && normalizeText(candidate.text).toLowerCase().includes(normalizeText(selectorSpec.text).toLowerCase())) {
      score += 35;
      reasons.push("text");
    }
    if (selectorSpec.tagName && candidate.tagName === selectorSpec.tagName) {
      score += 20;
      reasons.push("tagName");
    }
    if (candidate.visible) {
      score += 15;
      reasons.push("visible");
    }
    if (!candidate.disabled) {
      score += 10;
      reasons.push("enabled");
    }
    if (!candidate.outsideViewport) {
      score += 5;
      reasons.push("viewport");
    }

    return {
      ...candidate,
      score,
      reasons
    };
  }).sort((left, right) => right.score - left.score);

  const best = ranked[0];
  const second = ranked[1];
  const ambiguous = Boolean(best && second && best.score > 0 && best.score - second.score < 15);

  return {
    best,
    ranked,
    ambiguous
  };
}

export async function inspectLocator(locator) {
  const count = await locator.count();
  if (count === 0) {
    return {
      found: false,
      reason: "No matching element."
    };
  }
  const first = locator.first();
  return {
    found: true,
    count,
    text: normalizeText(await first.innerText().catch(() => "")),
    visible: await first.isVisible().catch(() => false),
    disabled: await first.isDisabled().catch(() => false),
    editable: await first.isEditable().catch(() => false),
    enabled: await first.isEnabled().catch(() => false)
  };
}
