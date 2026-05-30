import express from "express";
import { registerFaceRoutes } from "./relay/faces";
import { registerRelayRoutes } from "./relay/routes";
import { Logger } from "./utils/logger";

const logger = new Logger("Server");

/**
 * Builds the BLE relay Express app.
 *
 * Route groups (registration order matters — specific paths before the /api router):
 *   1. GET /health                — liveness probe
 *   2. registerFaceRoutes(app)    — GET/PUT/DELETE /api/faces*
 *   3. registerRelayRoutes(app)   — POST /api/* relay endpoints + photo-upload webhook;
 *                                   owns its own express.json({ limit: "10mb" }) on the /api
 *                                   router and prints the dev-auth warning (warnIfDevAuth).
 *
 * No global body parser is installed here: the relay router and the face routes each
 * attach their own json() with the right limit, and the multipart photo-upload webhook
 * must not have json() applied.
 */
export function buildApp() {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  registerFaceRoutes(app);
  registerRelayRoutes(app);

  logger.info("BLE relay app built");
  return app;
}
