import { buildApp } from "./server";
import { config } from "./utils/config";
import { Logger } from "./utils/logger";
import { loadPersistedFaces } from "./services/face-service";
import { initFaceStore } from "./services/face-store";
import { probeOpenRouterStatus } from "./services/openrouter-status";

const logger = new Logger("Main");

async function main(): Promise<void> {
  logger.info("Starting Suhail BLE relay server");
  logger.info(`Port: ${config.port}`);
  logger.info(`Language: ${config.defaultLanguage}`);

  const app = buildApp();

  // Init/verify the Rekognition collection before serving.
  await loadPersistedFaces();

  // Prepare the durable face store (Postgres when DATABASE_URL is set, else the
  // local-filesystem fallback). Never throws — persistence degrades gracefully.
  await initFaceStore();

  // Probe OpenRouter so an expired/over-quota key surfaces loudly at boot instead
  // of silently degrading intent classification + normalize. Best-effort, never throws.
  await probeOpenRouterStatus();

  app.listen(config.port, () => {
    logger.info(`Suhail BLE relay listening on port ${config.port}`);
  });
}

main().catch((err) => {
  logger.error("Fatal startup error:", err);
  process.exit(1);
});
