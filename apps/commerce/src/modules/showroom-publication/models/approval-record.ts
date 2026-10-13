import { model } from "@medusajs/framework/utils";

/**
 * Showroom publication approval record (TASK-COMMERCE-GATE-001).
 *
 * One row holds the versioned publication approval for exactly one subject —
 * a Medusa product, a designer profile, or a collection. It never holds a second
 * editable product or amount: the live product, price rows and collection stay
 * in Medusa, and this row only records the manual approval (authorization
 * window and markets, the approved price fingerprint, editorially reviewed copy
 * per locale, approved media provenance and withdrawal, and the audit trail).
 *
 * `subject_kind` and `subject_ref` identify the subject; the kind-specific parts
 * of `locales` are the only place editorial copy lives.
 */
export const ShowroomApprovalRecord = model.define("showroom_approval_record", {
  id: model.id().primaryKey(),
  subject_kind: model.text(),
  subject_ref: model.text(),
  public_revision: model.number(),
  authorization: model.json(),
  availability: model.text().nullable(),
  prices: model.json().nullable(),
  locales: model.json(),
  media: model.json(),
  audit: model.json(),
})
  // One approval per subject, enforced by the database rather than by a
  // read-then-write race: two concurrent first approvals for the same
  // subject_kind + subject_ref can never persist two rows.
  .indexes([
    {
      on: ["subject_kind", "subject_ref"],
      unique: true,
    },
  ]);

export default ShowroomApprovalRecord;
