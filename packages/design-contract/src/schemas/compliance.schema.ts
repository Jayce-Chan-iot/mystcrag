import { z } from "zod";

import { DISCLAIMER_KEYS } from "../constants/disclaimers";
import { IdentifierSchema, NonEmptyTextSchema } from "./component.schema";

export const ComplianceStatusSchema = z.enum(["PENDING", "PASSED", "FLAGGED", "REJECTED"]);
export const RestrictedClaimCategorySchema = z.enum([
  "MEDICAL_EFFECT",
  "PSYCHOLOGICAL_DIAGNOSIS",
  "GUARANTEED_WEALTH",
  "GUARANTEED_FORTUNE_CHANGE",
  "DETERMINISTIC_FORTUNE_PREDICTION",
  "OTHER_RESTRICTED_CLAIM"
]);
export const RestrictedClaimSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const RestrictedClaimSchema = z.strictObject({
  code: IdentifierSchema,
  category: RestrictedClaimCategorySchema,
  fieldPath: z.string().trim().min(1).max(500),
  severity: RestrictedClaimSeveritySchema,
  userVisibleMessage: NonEmptyTextSchema
});

export const ComplianceV1Schema = z
  .strictObject({
    complianceStatus: ComplianceStatusSchema,
    restrictedClaims: z.array(RestrictedClaimSchema),
    disclaimerKeys: z.array(z.enum(DISCLAIMER_KEYS)),
    reviewRequired: z.boolean()
  })
  .superRefine((compliance, context) => {
    if (compliance.complianceStatus === "FLAGGED" && !compliance.reviewRequired) {
      context.addIssue({
        code: "custom",
        message: "FLAGGED compliance requires human review",
        path: ["reviewRequired"]
      });
    }

    if (compliance.restrictedClaims.length > 0 && compliance.complianceStatus === "PASSED") {
      context.addIssue({
        code: "custom",
        message: "PASSED compliance cannot contain restricted claims",
        path: ["restrictedClaims"]
      });
    }
  });

export type RestrictedClaim = z.infer<typeof RestrictedClaimSchema>;
export type ComplianceV1 = z.infer<typeof ComplianceV1Schema>;
