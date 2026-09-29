import assert from "node:assert/strict";
import test from "node:test";

import {
  ORACLE_FULL_MOTION_STORAGE_KEY,
  ORACLE_FULL_REVEAL_MS,
  ORACLE_SHORT_REVEAL_MS,
  MAX_ORACLE_REVEAL_MS,
  readOracleFullMotionPreference,
  resolveOracleRevealDurationMs,
  shouldPlayFullOracleReveal,
  writeOracleFullMotionPreference,
  type OracleMotionStorage
} from "./oracle-motion-preference";

function memoryStorage(initial: Record<string, string> = {}): OracleMotionStorage & {
  dump(): Record<string, string>;
} {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
    dump() {
      return Object.fromEntries(map);
    }
  };
}

test("versioned full-motion key is the only persisted oracle preference", () => {
  assert.equal(ORACLE_FULL_MOTION_STORAGE_KEY, "mystcrag:oracle:full-motion:v1");

  const storage = memoryStorage();
  writeOracleFullMotionPreference(storage, false);

  assert.deepEqual(storage.dump(), {
    "mystcrag:oracle:full-motion:v1": "false"
  });
});

test("returning users can opt out of the full reveal and restore it", () => {
  const storage = memoryStorage();

  assert.equal(readOracleFullMotionPreference(storage), true, "first visit defaults to full motion");

  writeOracleFullMotionPreference(storage, false);
  assert.equal(readOracleFullMotionPreference(storage), false);

  writeOracleFullMotionPreference(storage, true);
  assert.equal(readOracleFullMotionPreference(storage), true);
});

test("malformed preference values fall back to full motion without throwing", () => {
  const storage = memoryStorage({ [ORACLE_FULL_MOTION_STORAGE_KEY]: "yes-please" });

  assert.equal(readOracleFullMotionPreference(storage), true);
});

test("reduced-motion always wins and uses the short reveal", () => {
  assert.equal(
    shouldPlayFullOracleReveal({ prefersReducedMotion: true, fullMotionEnabled: true }),
    false
  );
  assert.equal(
    resolveOracleRevealDurationMs({ prefersReducedMotion: true, fullMotionEnabled: true }),
    ORACLE_SHORT_REVEAL_MS
  );
  assert.equal(
    resolveOracleRevealDurationMs({ prefersReducedMotion: true, fullMotionEnabled: false }),
    ORACLE_SHORT_REVEAL_MS
  );
});

test("returning-user opt-out shortens the reveal even without reduced motion", () => {
  assert.equal(
    shouldPlayFullOracleReveal({ prefersReducedMotion: false, fullMotionEnabled: false }),
    false
  );
  assert.equal(
    resolveOracleRevealDurationMs({ prefersReducedMotion: false, fullMotionEnabled: false }),
    ORACLE_SHORT_REVEAL_MS
  );
});

test("full reveal stays within the 4000 ms budget", () => {
  assert.equal(
    shouldPlayFullOracleReveal({ prefersReducedMotion: false, fullMotionEnabled: true }),
    true
  );

  const duration = resolveOracleRevealDurationMs({
    prefersReducedMotion: false,
    fullMotionEnabled: true
  });

  assert.equal(duration, ORACLE_FULL_REVEAL_MS);
  assert.ok(duration <= MAX_ORACLE_REVEAL_MS, `reveal ${duration}ms must be <= ${MAX_ORACLE_REVEAL_MS}ms`);
  assert.ok(duration >= 2800, `full reveal ${duration}ms must stay in the approved 2.8-4s band`);
});

test("question, session, cast and identifiers are never written to motion storage", () => {
  const storage = memoryStorage();
  writeOracleFullMotionPreference(storage, true);

  const keys = Object.keys(storage.dump());
  for (const key of keys) {
    assert.equal(key, ORACLE_FULL_MOTION_STORAGE_KEY);
    assert.doesNotMatch(key, /question|session|cast|sessionId|operation/i);
    assert.doesNotMatch(storage.dump()[key] ?? "", /question|session|oracle-session|http/i);
  }
});
