import type {
  AssetImportErrorCode,
  AssetImportTransportErrorCode
} from "@mystcrag/design-contract";

export class AssetImportApiError extends Error {
  constructor(
    readonly transportCode: AssetImportTransportErrorCode,
    message: string,
    readonly assetCode?: AssetImportErrorCode
  ) {
    super(message);
    this.name = "AssetImportApiError";
  }
}
