import assert from "node:assert/strict";
import test from "node:test";

import { LOGOUT_FORM_SPEC, buildLoginHref, buildLogoutFormSpec, buildReturnTo } from "./auth-actions";

test("buildReturnTo returns '/' for the home page", () => {
  assert.equal(buildReturnTo({ pathname: "/", search: "", hash: "" }), "/");
});

test("buildReturnTo preserves pathname, query and hash exactly", () => {
  const location = { pathname: "/design/bracelet", search: "?tab=charm&id=42", hash: "#section" };
  assert.equal(buildReturnTo(location), "/design/bracelet?tab=charm&id=42#section");
});

test("buildLoginHref URL-encodes the returnTo value", () => {
  const location = { pathname: "/design/bracelet", search: "?tab=charm", hash: "#top" };
  assert.equal(
    buildLoginHref(location),
    `/auth/login?returnTo=${encodeURIComponent("/design/bracelet?tab=charm#top")}`
  );
});

test("buildLoginHref for the home page produces an encoded '/'", () => {
  assert.equal(
    buildLoginHref({ pathname: "/", search: "", hash: "" }),
    "/auth/login?returnTo=%2F"
  );
});

test("logout contract is a POST form navigation to /auth/logout", () => {
  assert.equal(LOGOUT_FORM_SPEC.method, "POST");
  assert.equal(LOGOUT_FORM_SPEC.action, "/auth/logout");
  assert.equal(buildLogoutFormSpec(), LOGOUT_FORM_SPEC);
});
