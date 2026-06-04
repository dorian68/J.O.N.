import assert from "node:assert/strict";
import { decomposeMissionSurfaces } from "../src/mission/mission-decomposition.js";

export async function run() {
  // The signature cross-surface case: open a website AND write to Notepad.
  const cinestar = decomposeMissionSurfaces(
    "ouvre moi le site cinestar et ecris moi sur un notepad toutes les seances de film pour demain stp"
  );
  assert.equal(cinestar.multiSurface, true, "cinestar mission should be multi-surface");
  assert.equal(cinestar.reason, "browser_then_desktop");
  assert.equal(cinestar.phases.length, 2);
  assert.equal(cinestar.phases[0].surface, "browser", "phase 1 = web gather");
  assert.equal(cinestar.phases[1].surface, "desktop", "phase 2 = desktop write");
  assert.equal(cinestar.phases[1].consumesPrevious, true, "desktop phase consumes web data");
  assert.equal(cinestar.phases[0].producesData, true);

  // English cross-surface case.
  const imdb = decomposeMissionSurfaces("open the imdb website and write the top 10 movies into notepad");
  assert.equal(imdb.multiSurface, true);
  assert.equal(imdb.phases[0].surface, "browser");
  assert.equal(imdb.phases[1].surface, "desktop");

  // Domain-based site + file write.
  const amazon = decomposeMissionSurfaces("va sur amazon.com, trouve le prix de l'iphone et écris-le dans un fichier texte");
  assert.equal(amazon.multiSurface, true);

  // Single-surface desktop — must NOT be flagged multi-surface.
  const desktopOnly = decomposeMissionSurfaces("ouvre notepad et écris bonjour");
  assert.equal(desktopOnly.multiSurface, false, "pure desktop should stay single-surface");

  // Single-surface research — no local surface at all.
  const researchOnly = decomposeMissionSurfaces("compare les pages candidates et produis une note de décision");
  assert.equal(researchOnly.multiSurface, false);

  // Pure web — single surface.
  const webOnly = decomposeMissionSurfaces("va sur amazon.com et liste les meilleures offres");
  assert.equal(webOnly.multiSurface, false);

  // Empty objective.
  assert.equal(decomposeMissionSurfaces("").multiSurface, false);
}
