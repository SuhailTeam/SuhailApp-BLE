import { afterEach, describe, expect, test } from "bun:test";
import { evict, getBytes, mintToken, storeBytes, waitForBytes } from "../../src/services/photo-cache";

const mintedTokens: string[] = [];

function mintTracked(deviceId = "integration-device") {
  const minted = mintToken(deviceId);
  mintedTokens.push(minted.photoToken);
  return minted;
}

afterEach(() => {
  for (const token of mintedTokens.splice(0)) {
    evict(token);
  }
});

describe("token-mediated photo flow integration", () => {
  test("minted token accepts an upload, wakes the waiter, and exposes cached bytes to consumers", async () => {
    const { photoToken } = mintTracked();
    const waiter = waitForBytes(photoToken, 100);
    const uploaded = Buffer.from("jpeg-like-bytes");

    expect(storeBytes(photoToken, uploaded)).toBe(true);

    const waited = await waiter;
    expect(waited?.toString()).toBe("jpeg-like-bytes");
    expect(getBytes(photoToken)?.toString("base64")).toBe(uploaded.toString("base64"));
  });

  test("evicted token cannot be uploaded or consumed", async () => {
    const { photoToken } = mintTracked();
    evict(photoToken);

    expect(storeBytes(photoToken, Buffer.from("late-upload"))).toBe(false);
    expect(await waitForBytes(photoToken, 1)).toBeNull();
    expect(getBytes(photoToken)).toBeNull();
  });
});
