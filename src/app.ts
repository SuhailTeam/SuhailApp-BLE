import * as fs from "node:fs/promises";
import { AppServer, type AppSession } from "@mentra/sdk";
import { routeCommand } from "./commands/command-router";
import { SceneSummarizeCommand } from "./commands/scene-summarize";
import { OcrReadTextCommand } from "./commands/ocr-read-text";
import { FaceRecognizeCommand } from "./commands/face-recognize";
import { FaceEnrollCommand } from "./commands/face-enroll";
import { FindObjectCommand } from "./commands/find-object";
import { CurrencyRecognizeCommand } from "./commands/currency-recognize";
import { VisualQACommand } from "./commands/visual-qa";
import { ColorDetectCommand } from "./commands/color-detect";
import { AIHandler } from "./services/ai-handler";
import { getFacePhotoPath } from "./services/face-service";
import { speak, speakBilingual, messages, getLastResponse, clearLastResponse } from "./services/tts-service";
import { config } from "./utils/config";
import { Logger } from "./utils/logger";
import type { CommandHandler, CommandType, ListeningState } from "./types";
import { isValidTranscription } from "./utils/transcription-filter";
import { normalizeTranscription } from "./utils/transcription-normalizer";
import { capturePhoto } from "./utils/image-utils";
import { getSettings, updateSettings, initSettingsFromStorage, clearSettingsSession } from "./services/settings-store";

const logger = new Logger("SuhailApp");

const COMMAND_TYPE_MAP: Record<string, string> = {
  "scene-summarize": "scene",
  "face-recognize": "face-recognize",
  "face-enroll": "face-enroll",
  "ocr-read-text": "ocr",
  "find-object": "find-object",
  "currency-recognize": "currency",
  "color-detect": "color",
  "visual-qa": "visual-qa",
};

/**
 * Main Suhail application server.
 * Handles MentraOS sessions, routes voice commands, and manages button presses.
 */
export class SuhailApp extends AppServer {
  /** Registry of command handlers */
  private handlers: Record<CommandType, CommandHandler>;

  /** Face enrollment handler (needs special access for pending state) */
  private faceEnrollHandler: FaceEnrollCommand;

  private ai = new AIHandler();

  /** Session IDs currently connected (tracked for the mini app UI) */
  private connectedSessions = new Set<string>();

  /** Sessions in listening mode (waiting for next voice command after swipe/button press) */
  private listeningSessions = new Map<string, {
    state: ListeningState;
    timer: ReturnType<typeof setTimeout>;
    activatedAt: number;
    abortController?: AbortController;
    preCapturePromise?: Promise<string | null>;
  }>();

  /** How long the listening window stays open after activation (ms) */
  private static readonly LISTENING_TIMEOUT_MS = 10_000;

  /** Minimum confidence (0-1) to accept a transcription. Below this is treated as noise. */
  private static readonly MIN_TRANSCRIPTION_CONFIDENCE = config.minTranscriptionConfidence;

  /** Sessions currently speaking (TTS echo guard — ignore transcriptions while speaking) */
  private speakingSessions = new Set<string>();

  /** Extra buffer after TTS finishes to let the mic settle (ms) */
  private static readonly TTS_ECHO_BUFFER_MS = 1_500;

  /** Grace period after activating listening to let the STT pipeline flush old audio (ms) */
  private static readonly LISTENING_GRACE_MS = 2_000;

  /** Rolling log of the last 20 activity events (served to the mini app UI) */
  private activityLog: Array<{
    time: string;
    type: string;
    command: string;
    result?: string;
    event: string;
  }> = [];

  /** Server start time for uptime calculation */
  private readonly startTime = Date.now();

  /** Most recent device state from the glasses (battery, case, wifi) */
  private deviceState: {
    battery: number | null;
    charging: boolean | null;
    caseBattery: number | null;
    caseCharging: boolean | null;
    wifiConnected: boolean | null;
  } = { battery: null, charging: null, caseBattery: null, caseCharging: null, wifiConnected: null };

  constructor() {
    super({
      packageName: config.packageName,
      apiKey: config.mentraApiKey,
      port: config.port,
      publicDir: "./landing/dist",
    });

    this.faceEnrollHandler = new FaceEnrollCommand();

    this.handlers = {
      "scene-summarize": new SceneSummarizeCommand(),
      "ocr-read-text": new OcrReadTextCommand(),
      "face-recognize": new FaceRecognizeCommand(),
      "face-enroll": this.faceEnrollHandler,
      "find-object": new FindObjectCommand(),
      "currency-recognize": new CurrencyRecognizeCommand(),
      "visual-qa": new VisualQACommand(),
      "color-detect": new ColorDetectCommand(),
    };

    this.registerApiRoutes();
    logger.info("SuhailApp initialized with all command handlers");
  }

  /** Loads persisted face records before the server starts accepting sessions. */
  async initialize(): Promise<void> {
    await this.ai.loadPersistedFaces();
  }

  /**
   * Registers /api/status and /api/activity routes on the SDK's Express instance.
   * These power the mini app web UI served from /public.
   */
  private registerApiRoutes(): void {
    const expressApp = this.getExpressApp();
    // Enable JSON body parsing for API routes (needed for PUT /api/faces/:faceId)
    const { json } = require("express");
    expressApp.use("/api", json());

    expressApp.get("/api/status", (_req: any, res: any) => {
      res.json({
        online: true,
        sessions: this.connectedSessions.size,
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        battery: this.deviceState.battery,
        charging: this.deviceState.charging,
        caseBattery: this.deviceState.caseBattery,
        caseCharging: this.deviceState.caseCharging,
        wifiConnected: this.deviceState.wifiConnected,
      });
    });

    expressApp.get("/api/activity", (_req: any, res: any) => {
      res.json(this.activityLog);
    });

    expressApp.get("/api/faces", async (_req: any, res: any) => {
      try {
        const faces = await this.ai.listFaces();
        res.json({ faces, count: faces.length });
      } catch (error) {
        logger.error("Failed to list faces:", error);
        res.status(500).json({ error: "Failed to list faces" });
      }
    });

    expressApp.get("/api/faces/:faceId/photo", async (req: any, res: any) => {
      try {
        const photoPath = getFacePhotoPath(req.params.faceId);
        await fs.access(photoPath);
        res.type("image/jpeg").sendFile(photoPath);
      } catch {
        res.status(404).json({ error: "Photo not found" });
      }
    });

    expressApp.delete("/api/faces/:faceId", async (req: any, res: any) => {
      try {
        await this.ai.deleteFace(req.params.faceId);
        res.json({ success: true });
      } catch (error) {
        logger.error("Failed to delete face:", error);
        res.status(500).json({ error: "Failed to delete face" });
      }
    });

    expressApp.put("/api/faces/:faceId", async (req: any, res: any) => {
      try {
        const { name } = req.body || {};
        if (!name || typeof name !== "string") {
          res.status(400).json({ error: "Name is required" });
          return;
        }
        await this.ai.renameFace(req.params.faceId, name);
        res.json({ success: true });
      } catch (error) {
        logger.error("Failed to rename face:", error);
        res.status(500).json({ error: "Failed to rename face" });
      }
    });

    expressApp.get("/webview", (_req: any, res: any) => {
      res.sendFile("index.html", { root: "./public" });
    });

    expressApp.get("/api/settings", (_req: any, res: any) => {
      res.json(getSettings());
    });

    expressApp.put("/api/settings", (req: any, res: any) => {
      try {
        const updated = updateSettings(req.body || {});
        res.json(updated);
      } catch (error) {
        logger.error("Failed to update settings:", error);
        res.status(500).json({ error: "Failed to update settings" });
      }
    });

    logger.info("API routes registered (/api/status, /api/activity, /api/faces, /api/settings, /webview)");
  }

  /**
   * Appends an event to the rolling activity log (capped at 20 entries).
   */
  private logActivity(event: string, type: string = "system", command: string = "", result?: string): void {
    this.activityLog.push({ time: new Date().toISOString(), type, command, result, event });
    while (this.activityLog.length > 20) {
      this.activityLog.shift();
    }
  }

  /**
   * Called when a new user session connects.
   * Sets up event listeners for voice and button input.
   */
  override async onSession(
    session: AppSession,
    sessionId: string,
    userId: string
  ): Promise<void> {
    logger.info(`New session started: ${sessionId} (user: ${userId})`);

    this.connectedSessions.add(sessionId);
    this.logActivity(`جلسة جديدة (${userId})`, "system", "session-start");

    // Load persisted settings from simpleStorage
    await initSettingsFromStorage(session);

    // Welcome the user
    await speakBilingual(session, messages.welcome);

    // Listen for voice transcriptions locked to the user's preferred language
    const langCode = config.defaultLanguage === "ar" ? "ar-SA" : "en-US";
    logger.info(`[${sessionId}] Transcription language locked to: ${langCode}`);
    session.events.onTranscriptionForLanguage(langCode, async (data) => {
      if (!data.isFinal) return;

      // Filter out low-confidence transcriptions (likely background noise)
      const confidence = data.confidence ?? 1;
      if (confidence < SuhailApp.MIN_TRANSCRIPTION_CONFIDENCE) {
        logger.info(`[${sessionId}] Dropped low-confidence transcription (${confidence.toFixed(2)}): "${data.text}"`);
        return;
      }

      // Discard transcriptions where detected language doesn't match configured language
      // Exception: allow Arabic-script text through when lang="en" (possible transliteration)
      if (data.detectedLanguage && !data.detectedLanguage.startsWith(config.defaultLanguage)) {
        const hasArabicScript = /[\u0600-\u06FF]/.test(data.text);
        const hasLatinChars = /[a-zA-Z]/.test(data.text);
        const mightBeTransliteration = config.defaultLanguage === "en" && hasArabicScript && !hasLatinChars;

        if (!mightBeTransliteration) {
          logger.info(`[${sessionId}] Dropped language-mismatch transcription (detected=${data.detectedLanguage}, expected=${langCode}): "${data.text}"`);
          return;
        }
        logger.info(`[${sessionId}] Language mismatch but possible transliteration — allowing: "${data.text}"`);
      }

      // Discard garbled or junk transcriptions
      if (!isValidTranscription(data.text, config.defaultLanguage)) {
        logger.info(`[${sessionId}] Dropped invalid transcription: "${data.text}"`);
        return;
      }

      // Normalize script mismatches (e.g., Arabic-script English transliterations)
      const normalizedText = await normalizeTranscription(data.text, config.defaultLanguage);

      logger.info(`[${sessionId}] Transcription (confidence=${confidence.toFixed(2)}): "${normalizedText}"`);
      await this.handleTranscription(session, sessionId, normalizedText);
    }, { disableLanguageIdentification: true });

    // Listen for button presses (log all for debugging)
    session.events.onButtonPress(async (event) => {
      logger.info(`[${sessionId}] Button press: buttonId="${event.buttonId}" pressType="${event.pressType}"`);
      await this.handleButtonPress(session, sessionId, event);
    });

    // Track device state via reactive observables (battery, case, wifi)
    const snapshot = session.device.state.getSnapshot();
    this.deviceState = {
      battery: snapshot.batteryLevel ?? null,
      charging: snapshot.charging ?? null,
      caseBattery: snapshot.caseBatteryLevel ?? null,
      caseCharging: snapshot.caseCharging ?? null,
      wifiConnected: snapshot.wifiConnected ?? null,
    };
    session.device.state.batteryLevel.onChange((level) => { this.deviceState.battery = level; });
    session.device.state.charging.onChange((charging) => { this.deviceState.charging = charging; });
    session.device.state.caseBatteryLevel.onChange((level) => { this.deviceState.caseBattery = level; });
    session.device.state.caseCharging.onChange((charging) => { this.deviceState.caseCharging = charging; });
    session.device.state.wifiConnected.onChange((connected) => { this.deviceState.wifiConnected = connected; });

    // Handle permission errors (camera/mic not granted)
    session.events.onPermissionError(async (data) => {
      logger.warn(`[${sessionId}] Permission error: ${JSON.stringify(data)}`);
      await speakBilingual(session, messages.permissionError, sessionId);
    });

    // Listen for touch/swipe gestures on the swipe pad
    session.events.onTouchEvent(async (event) => {
      logger.info(`[${sessionId}] Touch event: gesture="${event.gesture_name}" device="${event.device_model}"`);
      await this.handleTouchEvent(session, sessionId, event.gesture_name);
    });

    logger.info(`[${sessionId}] Session event listeners registered`);
  }

  /**
   * Called when a session ends. Cleans up tracking state.
   */
  override async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    this.connectedSessions.delete(sessionId);
    this.deactivateListening(sessionId);
    this.speakingSessions.delete(sessionId);
    clearLastResponse(sessionId);
    clearSettingsSession();
    this.logActivity(`انتهت الجلسة (${reason})`, "system", "session-stop");
    logger.info(`Session stopped: ${sessionId} (user: ${userId}, reason: ${reason})`);
  }

  /**
   * Handles a voice transcription by routing it to the correct command.
   * Only processes commands when listening mode is active (after left button press)
   * or when a face enrollment is pending.
   */
  private async handleTranscription(
    session: AppSession,
    sessionId: string,
    text: string
  ): Promise<void> {
    // Ignore empty or whitespace-only transcriptions
    if (!text || text.trim().length === 0) {
      logger.warn(`[${sessionId}] Empty transcription, ignoring`);
      return;
    }

    // TTS echo guard — ignore transcriptions while the app is speaking
    if (this.speakingSessions.has(sessionId)) {
      logger.info(`[${sessionId}] Ignored (TTS echo guard): "${text}"`);
      return;
    }

    try {
      // Check if we're waiting for a name during face enrollment (always active)
      if (this.faceEnrollHandler.hasPendingEnrollment(sessionId)) {
        logger.info(`[${sessionId}] Completing pending face enrollment with name: "${text}"`);
        await this.faceEnrollHandler.execute(session, { name: text, _sessionId: sessionId });
        return;
      }

      // Only process commands when listening mode is active
      const listeningEntry = this.listeningSessions.get(sessionId);
      if (!listeningEntry || listeningEntry.state !== "active") {
        logger.info(`[${sessionId}] Ignored (not listening): "${text}"`);
        return;
      }

      // Ignore transcriptions that arrive too soon after activation — these are
      // stale audio from before the swipe that the STT pipeline hadn't flushed yet
      const elapsed = Date.now() - listeningEntry.activatedAt;
      if (elapsed < SuhailApp.LISTENING_GRACE_MS) {
        logger.info(`[${sessionId}] Ignored (stale transcription, ${elapsed}ms after activation): "${text}"`);
        return;
      }

      // Transition to processing state
      clearTimeout(listeningEntry.timer);
      const abortController = new AbortController();
      listeningEntry.state = "processing";
      listeningEntry.abortController = abortController;

      // Acknowledge receipt
      await speakBilingual(session, messages.received, sessionId);

      // Route the transcription to the correct command (LLM-based, with keyword fallback)
      const route = await routeCommand(text, abortController.signal);
      if (!route) {
        this.deactivateListening(sessionId);
        return;
      }
      logger.info(`[${sessionId}] Routed to command: ${route.command}`);
      this.logActivity(`أمر صوتي: ${route.command}`, COMMAND_TYPE_MAP[route.command] ?? "system", route.command);

      // Handle "unknown" intent — not a visual command, speak help message
      if (route.command === ("unknown" as any)) {
        this.deactivateListening(sessionId);
        await speakBilingual(session, messages.unknownCommand, sessionId);
        return;
      }

      const handler = this.handlers[route.command];
      if (!handler) {
        logger.error(`[${sessionId}] No handler found for command: ${route.command}`);
        this.deactivateListening(sessionId);
        await speakBilingual(session, messages.generalError);
        return;
      }

      // Bounded wait on the pre-capture started during the swipe. If it isn't
      // ready by now, fall through and let AbstractCommandHandler capture fresh
      // — blocking on capturePhoto's full timeout here would stack two waits.
      const PRE_CAPTURE_WAIT_MS = 3_000;
      let preCapture: string | undefined;
      if (listeningEntry.preCapturePromise) {
        const result = await Promise.race([
          listeningEntry.preCapturePromise,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), PRE_CAPTURE_WAIT_MS)),
        ]);
        preCapture = result || undefined;
        logger.info(`[${sessionId}] Pre-capture ${result ? "ready" : "not ready, falling through"}`);
      }

      // Enable TTS echo guard before the handler speaks, clear after + buffer
      this.speakingSessions.add(sessionId);
      try {
        await handler.execute(session, { ...route.params, _sessionId: sessionId, ...(preCapture ? { _preCapture: preCapture } : {}) });
      } finally {
        this.deactivateListening(sessionId);
        setTimeout(() => {
          this.speakingSessions.delete(sessionId);
          logger.info(`[${sessionId}] TTS echo guard lifted`);
        }, SuhailApp.TTS_ECHO_BUFFER_MS);
      }
    } catch (error) {
      logger.error(`[${sessionId}] Error handling transcription:`, error);
      await speakBilingual(session, messages.generalError, sessionId);
    }
  }

  /**
   * Activates listening mode for a session, or cancels if already active/processing.
   * The next voice transcription within the timeout window will be processed as a command.
   */
  private async activateListening(session: AppSession, sessionId: string): Promise<void> {
    const existing = this.listeningSessions.get(sessionId);

    // If already active or processing, treat as cancellation
    if (existing && (existing.state === "active" || existing.state === "processing")) {
      await this.cancelListening(session, sessionId);
      return;
    }

    // Clear any leftover state
    this.deactivateListening(sessionId);

    const timer = setTimeout(async () => {
      const current = this.listeningSessions.get(sessionId);
      if (current && current.state === "active") {
        this.listeningSessions.delete(sessionId);
        logger.info(`[${sessionId}] Listening mode timed out`);
        await speakBilingual(session, messages.didntCatch, sessionId);
      }
    }, SuhailApp.LISTENING_TIMEOUT_MS);

    // Fire photo capture in parallel with the listening cue. Store the promise
    // (not the resolved value) so the transcription handler can await it on
    // demand — this avoids a race where a fast-talking user's transcription
    // is processed before the pre-capture has resolved.
    const preCapturePromise = capturePhoto(session);
    this.listeningSessions.set(sessionId, { state: "active", timer, activatedAt: Date.now(), preCapturePromise });
    logger.info(`[${sessionId}] Listening mode activated (${SuhailApp.LISTENING_TIMEOUT_MS / 1000}s window)`);

    await speakBilingual(session, messages.listening, sessionId);

    // Reset activation time so the grace period starts after the cue finishes
    const entry = this.listeningSessions.get(sessionId);
    if (entry && entry.state === "active") {
      entry.activatedAt = Date.now();
    }
  }

  /**
   * Cancels an active or in-progress listening session.
   */
  private async cancelListening(session: AppSession, sessionId: string): Promise<void> {
    const state = this.listeningSessions.get(sessionId);
    if (state) {
      state.abortController?.abort();
      clearTimeout(state.timer);
      this.listeningSessions.delete(sessionId);
      logger.info(`[${sessionId}] Listening cancelled (was ${state.state})`);
      await speakBilingual(session, messages.cancelled, sessionId);
    }
  }

  /**
   * Deactivates listening mode for a session (cleanup, no audio feedback).
   */
  private deactivateListening(sessionId: string): void {
    const state = this.listeningSessions.get(sessionId);
    if (state) {
      state.abortController?.abort();
      clearTimeout(state.timer);
      this.listeningSessions.delete(sessionId);
    }
  }

  /**
   * Handles touch/swipe gestures on the Mentra Live swipe pad.
   *
   * Gesture mapping:
   * - Forward swipe  → Activate listening mode (or cancel if already active/processing)
   * - Backward swipe → Repeat last response
   */
  private async handleTouchEvent(
    session: AppSession,
    sessionId: string,
    gestureName: string
  ): Promise<void> {
    try {
      if (gestureName === "forward_swipe") {
        this.logActivity("سحب للأمام ← وضع الاستماع", "system", "forward-swipe");
        await this.activateListening(session, sessionId);
      } else if (gestureName === "backward_swipe") {
        this.logActivity("سحب للخلف ← إعادة آخر رد", "system", "backward-swipe");
        await this.repeatLastResponse(session, sessionId);
      } else {
        logger.info(`[${sessionId}] Unhandled gesture: "${gestureName}"`);
      }
    } catch (error) {
      logger.error(`[${sessionId}] Error handling touch event:`, error);
      await speakBilingual(session, messages.generalError);
    }
  }

  /**
   * Handles physical button presses on the Mentra Live glasses.
   * Left button is used as fallback if swipe pad doesn't work.
   *
   * Button mapping:
   * - Short press (left)  → Interrupt and return to listening mode
   * - Long press (left)   → Repeat last response
   * - Right/camera button → Reserved (triggers native camera hardware)
   */
  private async handleButtonPress(
    session: AppSession,
    sessionId: string,
    event: { buttonId: string; pressType: "short" | "long" }
  ): Promise<void> {
    try {
      const { buttonId, pressType } = event;

      if (buttonId === "left" && pressType === "short") {
        await this.interruptAndReturnToListening(session, sessionId);
      } else if (buttonId === "left" && pressType === "long") {
        this.logActivity("زر يسار طويل ← إعادة آخر رد", "system", "left-long-press");
        await this.repeatLastResponse(session, sessionId);
      }
    } catch (error) {
      logger.error(`[${sessionId}] Error handling button press:`, error);
      await speakBilingual(session, messages.generalError);
    }
  }

  /**
   * Interrupts conversational state and returns the user to listening mode.
   * This is best-effort for in-flight work; it guarantees local state reset.
   */
  private async interruptAndReturnToListening(session: AppSession, sessionId: string): Promise<void> {
    this.logActivity("زر يسار قصير ← مقاطعة والعودة للاستماع", "system", "interrupt");

    this.deactivateListening(sessionId);
    this.faceEnrollHandler.interruptEnrollment(sessionId);
    this.speakingSessions.delete(sessionId);

    this.activateListening(session, sessionId);
    await speakBilingual(session, messages.interruptedListening, sessionId);
  }

  /**
   * Repeats the last spoken response for a session.
   */
  private async repeatLastResponse(session: AppSession, sessionId: string): Promise<void> {
    const lastResponse = getLastResponse(sessionId);
    if (lastResponse) {
      logger.info(`[${sessionId}] Repeating last response`);
      await speak(session, lastResponse, sessionId);
    } else {
      await speakBilingual(session, messages.repeatNoHistory, sessionId);
    }
  }
}
