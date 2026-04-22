import { createFixtureServer } from "../fixtures/fixture-server.js";
import { createPrototypeRuntime } from "../runtime/create-prototype-runtime.js";

const fixtureServer = await createFixtureServer();
const runtimeHandle = await createPrototypeRuntime({
  browserOptions: {
    headless: false
  }
});

try {
  const project = runtimeHandle.runtime.createProject({
    name: "Sample prototype project",
    description: "Manual sample mission",
    allowlistedDomains: ["127.0.0.1"]
  });

  const result = await runtimeHandle.runtime.runResearchMission({
    projectId: project.id,
    mission: "Compare the controlled candidate pages and produce a note de decision.",
    hubUrl: fixtureServer.manifest.hub,
    linkSpecs: [
      { testId: "link-alpha", title: "Alpha Analytics" },
      { testId: "link-beta", title: "Beta Commerce" },
      { testId: "link-gamma", title: "Gamma Ops" }
    ],
    fieldMap: {
      companyName: { testId: "company-name" },
      tagline: { testId: "company-tagline" },
      priceLevel: { testId: "price-level" },
      deliverySpeed: { testId: "delivery-speed" },
      riskNote: { testId: "risk-note" }
    }
  });

  console.log(JSON.stringify(result, null, 2));
} finally {
  await runtimeHandle.close();
  await fixtureServer.close();
}
