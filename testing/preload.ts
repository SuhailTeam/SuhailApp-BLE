/**
 * Bun test preload (server). Runs once before any test module is imported, so
 * `src/utils/config.ts` (which reads process.env at module load) sees these
 * deterministic values regardless of the developer's real .env.
 *
 * Tests that exercise an external call ALWAYS install a fetch mock
 * (testing/helpers/mock-openrouter.ts) or mock the AWS client
 * (testing/helpers/mock-rekognition.ts); these dummy keys exist only so the
 * code paths that gate on "is a key configured" behave deterministically.
 */
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.RELAY_SHARED_SECRET = "test-shared-secret";
process.env.AWS_REGION = "us-east-1";
process.env.AWS_REKOGNITION_COLLECTION_ID = "suhail-faces-test";
process.env.DEFAULT_LANGUAGE = "ar";
process.env.CONFIDENCE_THRESHOLD = "0.5";
// ElevenLabs intentionally left empty — those endpoints should 503 in tests.
delete process.env.ELEVENLABS_API_KEY;
