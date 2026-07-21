import { z } from "zod";

export const VisibilitySchema = z.enum(["PRIVATE", "UNLISTED", "PUBLIC"]);
export const CreatorDisplayModeSchema = z.enum(["ANONYMOUS", "DISPLAY_NAME"]);

export const CommunityV1Schema = z
  .strictObject({
    visibility: VisibilitySchema.default("PRIVATE"),
    publishConsent: z.boolean().default(false),
    allowRemix: z.boolean().default(false),
    creatorDisplayMode: CreatorDisplayModeSchema.default("ANONYMOUS")
  })
  .superRefine((community, context) => {
    if (!community.publishConsent && community.visibility !== "PRIVATE") {
      context.addIssue({
        code: "custom",
        message: "PUBLIC or UNLISTED visibility requires publish consent",
        path: ["visibility"]
      });
    }

    if (!community.publishConsent && community.allowRemix) {
      context.addIssue({
        code: "custom",
        message: "Remixing requires publish consent",
        path: ["allowRemix"]
      });
    }
  });

export type CommunityV1 = z.infer<typeof CommunityV1Schema>;
