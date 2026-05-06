import { Logger } from "../utils/logger";
import * as visionService from "./vision-service";
import * as ocrService from "./ocr-service";
import * as faceService from "./face-service";
import type {
  VisionResponse,
  FaceRecognitionResult,
  MultiFaceResult,
  ObjectDetectionResult,
  CurrencyResult,
  ColorResult,
} from "../types";

const logger = new Logger("AIHandler");

/**
 * Unified AI service facade.
 * Routes requests to the correct underlying service.
 */
export class AIHandler {
  /** Load persisted enrolled faces into memory */
  async loadPersistedFaces(): Promise<void> {
    await faceService.loadPersistedFaces();
  }

  /** Describe a scene from a photo */
  async describeScene(imageBase64: string): Promise<VisionResponse> {
    logger.info("AI Handler → Scene Description");
    return visionService.describeScene(imageBase64);
  }

  /** Extract text from a photo via OCR */
  async readText(imageBase64: string, context?: string): Promise<string> {
    logger.info("AI Handler → OCR Text Extraction");
    return ocrService.extractText(imageBase64, context);
  }

  /** Recognize a face in a photo */
  async recognizeFace(imageBase64: string): Promise<FaceRecognitionResult> {
    logger.info("AI Handler → Face Recognition");
    return faceService.recognizeFace(imageBase64);
  }

  /** Recognize all faces in a photo */
  async recognizeAllFaces(imageBase64: string): Promise<MultiFaceResult> {
    logger.info("AI Handler → Multi-Face Recognition");
    return faceService.recognizeAllFaces(imageBase64);
  }

  /** Describe a scene with known face names injected */
  async describeSceneWithFaces(imageBase64: string, knownNames: string[]): Promise<VisionResponse> {
    logger.info("AI Handler → Scene Description with Face Context");
    return visionService.describeSceneWithFaces(imageBase64, knownNames);
  }

  /** Enroll a new face with a name */
  async enrollFace(name: string, imageBase64: string): Promise<string | null> {
    logger.info(`AI Handler → Face Enrollment for "${name}"`);
    return faceService.enrollFace(name, imageBase64);
  }

  /** List all enrolled faces */
  async listFaces(): Promise<Array<{ name: string; faceId: string; hasPhoto: boolean; enrolledAt: string | null }>> {
    logger.info("AI Handler → List Faces");
    return faceService.listFaces();
  }

  /** Delete an enrolled face */
  async deleteFace(faceId: string): Promise<void> {
    logger.info(`AI Handler → Delete Face ${faceId}`);
    return faceService.deleteFace(faceId);
  }

  /** Rename an enrolled face */
  async renameFace(faceId: string, newName: string): Promise<void> {
    logger.info(`AI Handler → Rename Face ${faceId} to "${newName}"`);
    return faceService.renameFace(faceId, newName);
  }

  /** Find a specific object in a photo */
  async findObject(
    imageBase64: string,
    objectName: string,
  ): Promise<ObjectDetectionResult> {
    logger.info(`AI Handler → Find Object: "${objectName}"`);
    const result = await visionService.detectObject(imageBase64, objectName);
    return {
      objectName,
      found: result.found,
      location: result.location,
      confidence: result.confidence,
    };
  }

  /** Recognize currency in a photo */
  async recognizeCurrency(imageBase64: string): Promise<CurrencyResult> {
    logger.info("AI Handler → Currency Recognition");
    const result = await visionService.recognizeCurrency(imageBase64);
    return {
      denomination: result.denomination,
      currency: result.currency,
      confidence: result.confidence,
    };
  }

  /** Answer a visual question about a photo */
  async answerVisualQuestion(
    imageBase64: string,
    question: string,
  ): Promise<VisionResponse> {
    logger.info("AI Handler → Visual QA");
    return visionService.answerVisualQuestion(imageBase64, question);
  }

  /** Detect the dominant color in a photo */
  async detectColor(imageBase64: string): Promise<ColorResult> {
    logger.info("AI Handler → Color Detection");
    return visionService.detectColor(imageBase64);
  }
}
