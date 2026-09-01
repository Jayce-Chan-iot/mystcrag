import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIAL_SESSION_STATUS,
  classifySessionResponse,
  reduceSessionStatus
} from "./session-status";

test("initial session status is loading", () => {
  assert.equal(INITIAL_SESSION_STATUS, "loading");
});

test("classifySessionResponse accepts only explicit authenticated === true", () => {
  assert.equal(classifySessionResponse({ authenticated: true }), "authenticated");
  assert.equal(classifySessionResponse({ authenticated: false }), "unauthenticated");
  assert.equal(classifySessionResponse({}), "unauthenticated");
  assert.equal(classifySessionResponse({ authenticated: "true" }), "unauthenticated");
});

test("resolved and failed events are consumed from loading", () => {
  assert.equal(reduceSessionStatus("loading", { type: "resolved", authenticated: true }), "authenticated");
  assert.equal(reduceSessionStatus("loading", { type: "resolved", authenticated: false }), "unauthenticated");
  assert.equal(reduceSessionStatus("loading", { type: "failed" }), "error");
});

test("outcomes never overwrite a settled state within the same fetch cycle", () => {
  assert.equal(reduceSessionStatus("authenticated", { type: "failed" }), "authenticated");
  assert.equal(reduceSessionStatus("unauthenticated", { type: "failed" }), "unauthenticated");
  assert.equal(reduceSessionStatus("error", { type: "resolved", authenticated: true }), "error");
  assert.equal(reduceSessionStatus("authenticated", { type: "resolved", authenticated: false }), "authenticated");
});

test("reset always returns to loading so a new fetch cycle can settle", () => {
  assert.equal(reduceSessionStatus("authenticated", { type: "reset" }), "loading");
  assert.equal(reduceSessionStatus("error", { type: "reset" }), "loading");
  assert.equal(reduceSessionStatus("unauthenticated", { type: "reset" }), "loading");
  assert.equal(reduceSessionStatus("loading", { type: "reset" }), "loading");
});
