import { sha256OfBytes, type ArchiveStore } from "@mystcrag/asset-pipeline";
import type { AssetImportRepository } from "@mystcrag/database";
import {
  APPROVED_ASSET_CACHE_CONTROL,
  ApprovedAssetDeliveryMetadataSchema,
  approvedAssetDeliveryHeaders
} from "@mystcrag/design-contract";

import { AssetImportApiError, normalizeAssetImportError } from "../bead-asset-import/bead-asset-import.errors.js";

type Repository = Pick<AssetImportRepository, "findApprovedPublicAsset">;
type Store = Pick<ArchiveStore, "read">;

export class ProductAssetService {
  constructor(private readonly deps: { repository: Repository; archiveStore: Store }) {}

  async resolve(assetKey: string) {
    try {
      const asset = await this.deps.repository.findApprovedPublicAsset(assetKey);
      if (asset === null) {
        throw new AssetImportApiError("NOT_FOUND", "The approved asset was not found.");
      }
      const bytes = await this.deps.archiveStore.read(asset.storageKey);
      const byteSize = Number(asset.outputBytes);
      const sha256 = sha256OfBytes(bytes);
      if (
        !Number.isSafeInteger(byteSize) || byteSize <= 0 || bytes.byteLength !== byteSize ||
        sha256 !== asset.outputSha256 || asset.assetKey !== `approved:${sha256}`
      ) {
        throw new AssetImportApiError("INTERNAL_ERROR", "Approved asset integrity verification failed.");
      }
      const parsedMetadata = ApprovedAssetDeliveryMetadataSchema.safeParse({
        assetKey: asset.assetKey,
        contentType: asset.outputContentType,
        byteSize,
        sha256,
        etag: `"${sha256}"`,
        cacheControl: APPROVED_ASSET_CACHE_CONTROL
      });
      if (!parsedMetadata.success) {
        throw new AssetImportApiError("INTERNAL_ERROR", "Approved asset integrity verification failed.");
      }
      const metadata = parsedMetadata.data;
      return { bytes, metadata, headers: approvedAssetDeliveryHeaders(metadata) };
    } catch (error) {
      throw normalizeAssetImportError(error);
    }
  }
}
