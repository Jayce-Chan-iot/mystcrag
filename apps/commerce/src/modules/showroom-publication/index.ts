import { Module } from "@medusajs/framework/utils";

import ShowroomPublicationService from "./service";

/** Container key the showroom publication service is registered under. */
export const SHOWROOM_PUBLICATION_MODULE = "showroom_publication";

/**
 * The showroom publication module: versioned manual approvals (authorization,
 * approved price fingerprint, per-locale reviewed copy, approved media
 * provenance and the audit trail) for products, designers and collections. It
 * owns no product or amount of its own — those stay in Medusa.
 */
export default Module(SHOWROOM_PUBLICATION_MODULE, {
  service: ShowroomPublicationService
});
