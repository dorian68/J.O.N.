import assert from "node:assert/strict";
import { applySurfaceRouteToMission, routeMissionToSurface } from "../src/runtime/surface-router.js";

export async function run() {
  const applications = [
    { id: "notepad", label: "Notepad", kind: "text_editor" }
  ];
  const browsers = [
    { id: "edge", label: "Microsoft Edge" },
    { id: "chrome", label: "Google Chrome" }
  ];

  {
    const route = routeMissionToSurface({
      missionSpec: {
        objective: "Open Notepad, write 'hello cowork', take a screenshot."
      },
      availableApplications: applications,
      availableBrowsers: browsers
    });
    assert.equal(route.selectedSurface, "desktop");
    assert.equal(route.selectedProvider, "desktop.notepad");
    assert.equal(route.normalizedParameters.computerAction.type, "desktop_autonomy");
    assert.equal(route.normalizedParameters.applicationLaunch.applicationId, "notepad");
    assert.ok(route.expectedTools.includes("desktop.launchApplication"));
    assert.ok(route.expectedTools.includes("desktop.typeText"));
    assert.ok(route.expectedTools.includes("desktop.captureScreenshot"));
  }

  {
    const route = routeMissionToSurface({
      missionSpec: {
        objective: "Open Chrome or Edge, search for 'Node.js documentation', take a screenshot."
      },
      availableApplications: applications,
      availableBrowsers: browsers
    });
    assert.equal(route.selectedSurface, "browser");
    assert.equal(route.normalizedParameters.browserLaunch.browserId, "chrome");
    assert.equal(route.normalizedParameters.browserLaunch.searchQuery, "Node.js documentation");
    assert.equal(route.normalizedParameters.computerAction.type, "browser_autonomy");
    assert.equal(route.normalizedParameters.browserAutonomy.startUrl, "https://nodejs.org/");
    assert.equal(route.normalizedParameters.browserAutonomy.mode, "coworker_browser_loop");
  }

  {
    const route = routeMissionToSurface({
      missionSpec: {
        objective: "Open my browser, search for 'Node.js documentation', take a screenshot."
      },
      availableApplications: applications,
      availableBrowsers: browsers,
      userPreferences: {
        preferredBrowser: {
          id: "edge",
          label: "Microsoft Edge",
          source: "explicit_user_message",
          confidence: 0.95
        }
      }
    });
    assert.equal(route.selectedSurface, "browser");
    assert.equal(route.normalizedParameters.browserLaunch.browserId, "edge");
    assert.equal(route.normalizedParameters.browserLaunch.selectionSource, "explicit_user_message");
    assert.equal(route.normalizedParameters.computerAction.type, "browser_autonomy");
  }

  {
    const route = routeMissionToSurface({
      missionSpec: {
        objective: "Open Chrome, search for 'Node.js documentation'."
      },
      availableApplications: applications,
      availableBrowsers: browsers,
      userPreferences: {
        preferredBrowser: {
          id: "edge",
          label: "Microsoft Edge",
          source: "explicit_user_message",
          confidence: 0.95
        }
      }
    });
    assert.equal(route.normalizedParameters.browserLaunch.browserId, "chrome");
    assert.equal(route.normalizedParameters.browserLaunch.selectionSource, "explicit_user_text");
  }

  {
    const route = routeMissionToSurface({
      missionSpec: {
        objective: "ouvre Chrome et cherche Node.js documentation puis prends une capture"
      },
      availableApplications: applications,
      availableBrowsers: browsers
    });
    assert.equal(route.selectedSurface, "browser");
    assert.equal(route.normalizedParameters.browserLaunch.targetSite, "nodejs.org");
    assert.equal(route.normalizedParameters.browserLaunch.searchQuery, "Node.js documentation");
    assert.equal(route.normalizedParameters.computerAction.type, "browser_autonomy");
  }

  {
    const route = routeMissionToSurface({
      missionSpec: {
        objective: "Go to eBay and list current deals on high-end Android smartphones",
        deliverable: "List current eBay deals with links"
      },
      availableApplications: applications,
      availableBrowsers: browsers
    });
    assert.equal(route.selectedSurface, "browser");
    assert.equal(route.normalizedParameters.computerAction.type, "browser_autonomy");
    assert.equal(route.normalizedParameters.browserLaunch.targetSite, "ebay.com");
    assert.equal(route.normalizedParameters.browserAutonomy.startUrl, "https://ebay.com/");
    assert.equal(route.normalizedParameters.browserAutonomy.mode, "coworker_browser_loop");
    assert.equal(route.expectedTools.includes("browser.extractDom"), true);
  }

  {
    const route = routeMissionToSurface({
      missionSpec: {
        objective: "peux tu aller sur upwork et me trouver 5 postes sur excel"
      },
      availableApplications: applications,
      availableBrowsers: []
    });
    assert.equal(route.selectedSurface, "browser");
    assert.equal(route.selectedProvider, "browser.bundled_chromium");
    assert.equal(route.normalizedParameters.computerAction.type, "browser_autonomy");
    assert.equal(route.normalizedParameters.browserAutonomy.visible, true);
    assert.equal(route.blockers.length, 0);
  }

  {
    const route = routeMissionToSurface({
      missionSpec: {
        objective: "Accéder au site SaaStr et lister les articles de croissance B2B SaaS les plus partagés ce mois-ci.",
        deliverable: "Liste des articles avec titres et liens."
      },
      availableApplications: applications,
      availableBrowsers: browsers
    });
    assert.equal(route.selectedSurface, "browser");
    assert.equal(route.normalizedParameters.computerAction.type, "browser_autonomy");
    assert.equal(route.normalizedParameters.browserLaunch.targetSite, "saastr.com");
    assert.equal(route.normalizedParameters.browserAutonomy.startUrl, "https://saastr.com/");
  }

  {
    const route = routeMissionToSurface({
      missionSpec: {
        objective: "va sur upwork et copie moi ma description ici",
        parameters: {
          browserLaunch: {
            browserId: "chrome",
            targetSite: "upwork",
            url: "https://www.upwork.com/freelancers/~me",
            searchUrl: "https://www.google.com/search?q=upwork%20profiles"
          },
          computerAction: {
            type: "browser_autonomy"
          }
        }
      },
      availableApplications: applications,
      availableBrowsers: browsers
    });
    assert.equal(route.selectedSurface, "browser");
    assert.equal(route.normalizedParameters.browserLaunch.targetSite, "upwork.com");
    assert.equal(route.normalizedParameters.browserAutonomy.startUrl, "https://www.upwork.com/freelancers/~me");
    assert.equal(route.normalizedParameters.browserAutonomy.allowlistedHosts.includes("upwork.com"), true);
    assert.equal(route.normalizedParameters.browserAutonomy.allowlistedHosts.includes("www.upwork.com"), true);
  }

  {
    const route = routeMissionToSurface({
      missionSpec: {
        objective: "Which folders are present on my Desktop?"
      },
      availableApplications: applications,
      availableBrowsers: browsers
    });
    const mission = applySurfaceRouteToMission({ objective: "Which folders are present on my Desktop?" }, route);
    assert.equal(route.selectedSurface, "files");
    assert.equal(mission.mode, "computer");
    assert.equal(mission.parameters.computerAction.type, "desktop_autonomy");
  }

  {
    const route = routeMissionToSurface({
      missionSpec: {
        objective: "On the desktop, click the Search button."
      },
      availableApplications: applications,
      availableBrowsers: browsers
    });
    assert.equal(route.selectedSurface, "desktop");
    assert.equal(route.normalizedParameters.computerAction.type, "desktop_autonomy");
    assert.equal(route.normalizedParameters.browserLaunch, undefined);
  }
}
