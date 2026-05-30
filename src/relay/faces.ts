import * as fs from "node:fs/promises";
import express from "express";
import { listFaces, deleteFace, renameFace, getFacePhotoPath } from "../services/face-service";
import { Logger } from "../utils/logger";
import { relayAuth } from "./auth";

const logger = new Logger("FaceRoutes");

/**
 * Registers the face-management routes the BLE mobile Contacts screen depends on.
 * Mounted directly on the Express app (NOT the relay router) so the unauthenticated
 * photo route can opt out of HMAC auth individually.
 *
 * - GET    /api/faces                list enrolled faces           (HMAC-authed)
 * - GET    /api/faces/:faceId/photo  enrollment photo (image tag)  (UNAUTHENTICATED)
 * - PUT    /api/faces/:faceId        rename                        (HMAC-authed)
 * - DELETE /api/faces/:faceId        delete                        (HMAC-authed)
 *
 * Must be registered BEFORE the relay router's `app.use("/api", router)` so these
 * specific GET/PUT/DELETE paths win over the router. They never collide with the
 * relay's POST /api/faces/{recognize,recognize-all,enroll}.
 */
export function registerFaceRoutes(app: any): void {
  const jsonBody = express.json({ limit: "1mb" });

  app.get("/api/faces", relayAuth, async (_req: any, res: any) => {
    try {
      const faces = await listFaces();
      res.json({ faces, count: faces.length });
    } catch (error) {
      logger.error("Failed to list faces:", error);
      res.status(500).json({ error: "Failed to list faces" });
    }
  });

  app.get("/api/faces/:faceId/photo", async (req: any, res: any) => {
    try {
      const photoPath = getFacePhotoPath(req.params.faceId);
      await fs.access(photoPath);
      res.type("image/jpeg").sendFile(photoPath);
    } catch {
      res.status(404).json({ error: "Photo not found" });
    }
  });

  app.put("/api/faces/:faceId", relayAuth, jsonBody, async (req: any, res: any) => {
    try {
      const { name } = req.body || {};
      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "Name is required" });
        return;
      }
      await renameFace(req.params.faceId, name);
      res.json({ success: true });
    } catch (error) {
      logger.error("Failed to rename face:", error);
      res.status(500).json({ error: "Failed to rename face" });
    }
  });

  app.delete("/api/faces/:faceId", relayAuth, async (req: any, res: any) => {
    try {
      await deleteFace(req.params.faceId);
      res.json({ success: true });
    } catch (error) {
      logger.error("Failed to delete face:", error);
      res.status(500).json({ error: "Failed to delete face" });
    }
  });

  logger.info("Face routes registered (GET /api/faces, GET :id/photo, PUT/DELETE :id)");
}
