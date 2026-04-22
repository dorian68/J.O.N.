import { createOperatorServer } from "../server/operator-server.js";

const requestedPort = process.env.COWORK_OPERATOR_PORT
  ? Number.parseInt(process.env.COWORK_OPERATOR_PORT, 10)
  : undefined;

const server = await createOperatorServer({
  port: Number.isFinite(requestedPort) ? requestedPort : undefined
});

console.log(`Operator server ready at ${server.baseUrl}`);
console.log("Press Ctrl+C to stop.");

async function shutdown() {
  await server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
