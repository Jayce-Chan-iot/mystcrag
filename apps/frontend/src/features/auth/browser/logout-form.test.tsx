/**
 * Logout form helper tests: the single injectable DOM helper used by useSession.
 * Verified against a lightweight fake document — no DOM library required.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { submitLogoutForm, type LogoutFormElementLike, type LogoutFormDocumentLike } from "./logout-form";

function makeFakeDocument(): {
  doc: LogoutFormDocumentLike;
  appended: LogoutFormElementLike[];
  forms: Array<LogoutFormElementLike & { submitCalls: number }>;
} {
  const appended: LogoutFormElementLike[] = [];
  const forms: Array<LogoutFormElementLike & { submitCalls: number }> = [];
  const doc: LogoutFormDocumentLike = {
    createElement: (tag) => {
      assert.equal(tag, "form");
      const form: LogoutFormElementLike & { submitCalls: number } = {
        method: "",
        action: "",
        style: { display: "" },
        submitCalls: 0,
        submit() {
          form.submitCalls += 1;
        }
      };
      forms.push(form);
      return form;
    },
    body: {
      appendChild(element: LogoutFormElementLike) {
        appended.push(element);
      }
    }
  };
  return { doc, appended, forms };
}

test("submitLogoutForm creates a POST form targeting /auth/logout", () => {
  const { doc, forms } = makeFakeDocument();
  submitLogoutForm(doc);
  assert.equal(forms.length, 1);
  const form = forms[0];
  if (!form) throw new Error("expected a created form");
  assert.equal(form.method, "POST");
  assert.equal(form.action, "/auth/logout");
});

test("submitLogoutForm appends the form to body before submitting", () => {
  const { doc, appended, forms } = makeFakeDocument();
  const order: string[] = [];

  // Instrument append and submit to prove the append-before-submit order.
  const originalAppend = doc.body.appendChild.bind(doc.body);
  doc.body.appendChild = (element) => {
    order.push("append");
    originalAppend(element);
  };
  const originalCreate = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const created = originalCreate(tag);
    const innerSubmit = created.submit.bind(created);
    created.submit = () => {
      order.push("submit");
      innerSubmit();
    };
    return created;
  };

  submitLogoutForm(doc);
  assert.deepEqual(order, ["append", "submit"]);
  assert.equal(appended.length, 1);
  assert.equal(forms[0]?.submitCalls, 1);
});

test("submitLogoutForm submits exactly once and hides the form", () => {
  const { doc, forms, appended } = makeFakeDocument();
  submitLogoutForm(doc);
  const form = forms[0];
  if (!form) throw new Error("expected a created form");
  assert.equal(form.submitCalls, 1);
  assert.equal(form.style.display, "none");
  assert.strictEqual(appended[0], form);
});
