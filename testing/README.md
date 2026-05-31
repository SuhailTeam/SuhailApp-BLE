# Suhail Automated Unit Tests

This folder contains the automated unit tests derived from Section 13.2 of the GP2 document.

Run them from the repository root:

```bash
bun run test:unit
bun run test:integration
bun run test:regression
```

Traceability:

- `transcription-filter.test.ts`: EP and BVA coverage for valid/invalid transcription classes, wrong-script filtering, Arabic-script normalization detection, and Scribe annotation stripping.
- `command-router.test.ts`: decision-table coverage for the hybrid intent router with the LLM branch stubbed at the network boundary.
- `listening-state-machine.test.ts`: state-transition and boundary coverage for the listening state machine and grace/echo filters.
- `ocr-format.test.ts`: boundary coverage for OCR whitespace normalization and 400-character cap enforcement.
- `transcription-normalizer.test.ts`: regression coverage for Arabic-script English normalization and provider-failure fallback.
- `face-service.test.ts`: round-trip property coverage for Rekognition `ExternalImageId` hex encoding.
- `vision-service.test.ts`: EP coverage for per-denomination currency parsing, dominant-color parsing, and malformed model output.
- `relay-auth.test.ts`: Phase 2 HMAC relay authentication coverage.
- `photo-cache.test.ts`: Phase 2 photo-token lifecycle coverage, including upload, wait, eviction, and expiry behavior.

Integration tests:

- `intent-pipeline.integration.test.ts`: validates the offline speech-command pipeline from annotation cleanup and transcription validation through hybrid router dispatch.
- `photo-flow.integration.test.ts`: validates the Phase 2 token-mediated photo flow from token minting through upload completion and cached image retrieval.
- `face-enrollment-flow.integration.test.ts`: validates the two-step face-enrollment state flow, including pending-name interception, processing lock, success consumption, timeout clear, and interrupt behavior.

Regression tests:

- `known-fixes.regression.test.ts`: locks in previously fixed edge cases so they do not reappear during later changes, including Scribe annotation cleanup, router degraded-mode fallback, Arabic `ExternalImageId` round trips, photo waiters, and face-enrollment interruption suppression.
