import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./load-module.mjs";
const { parsePageRange } = await loadModule("src/services/pdf/pageRange.ts");
test("page ranges deduplicate and remain in document order", () => {
  assert.deepEqual([...parsePageRange("8-10, 1-3, 2, 5", 500)], [1,2,3,5,8,9,10]);
});
test("page ranges reject malformed, reversed, fractional, empty, and out-of-bounds input", () => {
  for (const value of ["", "0", "1,", "5-2", "2.5", "1--3", "501", "-1", "2e2", "1-99999999999999999"]) {
    assert.throws(() => parsePageRange(value, 500), undefined, value);
  }
});

test("hand preference survives restart, handles invalid data and unavailable storage", async () => {
  const storage = new Map();
  const { initialPointerMode, storePointerMode } = await loadModule("src/services/pdf/pointer.ts", {}, {
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key,value) },
  });
  assert.equal(initialPointerMode(), "select");
  storePointerMode("hand"); assert.equal(initialPointerMode(), "hand");
  storePointerMode("select"); assert.equal(initialPointerMode(), "select");
  storage.set("openpdf.pointerMode", "invalid"); assert.equal(initialPointerMode(), "select");
  const unavailable = await loadModule("src/services/pdf/pointer.ts");
  assert.equal(unavailable.initialPointerMode(), "select");
  assert.doesNotThrow(() => unavailable.storePointerMode("hand"));
});
