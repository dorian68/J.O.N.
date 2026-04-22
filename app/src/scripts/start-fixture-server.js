import { createFixtureServer } from "../fixtures/fixture-server.js";

const server = await createFixtureServer();
console.log(`Fixture server listening on ${server.baseUrl}`);
