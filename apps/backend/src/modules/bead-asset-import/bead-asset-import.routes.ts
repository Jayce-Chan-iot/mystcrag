import type { Readable } from "node:stream";

import {
  ASSET_MANIFEST_LIMITS,
  AssetFileContentParamsSchema,
  AssetImportSessionResponseSchema,
  CancelAssetImportSessionParamsSchema,
  CancelAssetImportSessionRequestSchema,
  CancelAssetImportSessionResponseSchema,
  CheckBeadProductDraftCompletenessParamsSchema,
  CheckBeadProductDraftCompletenessResponseSchema,
  CreateAssetImportSessionRequestSchema,
  CreateAssetImportSessionResponseSchema,
  GetBeadImageGroupPublishResultParamsSchema,
  GetBeadImageGroupPublishResultResponseSchema,
  IdentifierSchema,
  ListAssetImportSessionsQuerySchema,
  ListAssetImportSessionsResponseSchema,
  ListCrystalsQuerySchema,
  ListCrystalsResponseSchema,
  ProcessedAssetContentParamsSchema,
  ProcessedAssetContentQuerySchema,
  PublishBeadImageGroupParamsSchema,
  PublishBeadImageGroupRequestSchema,
  PublishBeadImageGroupResponseSchema,
  RegisterAssetManifestParamsSchema,
  RegisterAssetManifestRequestSchema,
  RegisterAssetManifestResponseSchema,
  ReprocessBeadImageGroupParamsSchema,
  ReprocessBeadImageGroupRequestSchema,
  ReprocessBeadImageGroupResponseSchema,
  ReviewProcessedAssetParamsSchema,
  ReviewProcessedAssetRequestSchema,
  ReviewProcessedAssetResponseSchema,
  SaveBeadProductDraftParamsSchema,
  SaveBeadProductDraftRequestSchema,
  SaveBeadProductDraftResponseSchema,
  SelectProcessedVersionParamsSchema,
  SelectProcessedVersionRequestSchema,
  SelectProcessedVersionResponseSchema,
  Sha256Schema,
  StartAssetImportGroupingParamsSchema,
  StartAssetImportGroupingRequestSchema,
  StartAssetImportGroupingResponseSchema,
  StartAssetImportProcessingParamsSchema,
  StartAssetImportProcessingRequestSchema,
  StartAssetImportProcessingResponseSchema,
  UpdateBeadImageGroupParamsSchema,
  UpdateBeadImageGroupRequestSchema,
  UpdateBeadImageGroupResponseSchema,
  UpdateCrystalDraftCurationParamsSchema,
  UpdateCrystalDraftCurationRequestSchema,
  UpdateCrystalDraftCurationResponseSchema,
  UploadAssetFileParamsSchema,
  UploadAssetFileResponseSchema
} from "@mystcrag/design-contract";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { authenticateAssetAdminKey } from "./bead-asset-import.auth.js";
import {
  AssetImportApiError,
  assertAssetErrorPair,
  assetImportErrorEnvelope,
  normalizeAssetImportError
} from "./bead-asset-import.errors.js";
import type { AssetImportApplicationService } from "./bead-asset-import.service.js";

const SessionParamsSchema = z.strictObject({ sessionId: IdentifierSchema });
const UploadPathParamsSchema = z.strictObject({ sessionId: IdentifierSchema, fileId: IdentifierSchema });
const validatedUploadParams = new WeakMap<FastifyRequest, z.infer<typeof UploadAssetFileParamsSchema>>();

type DistinctHeaders = Record<string, readonly string[] | undefined>;

function distinctRequestHeaders(request: FastifyRequest): DistinctHeaders {
  const native = request.raw.headersDistinct;
  if (native !== undefined) return native as DistinctHeaders;
  const collected: Record<string, string[]> = {};
  for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
    const name = request.raw.rawHeaders[index]?.toLowerCase();
    const value = request.raw.rawHeaders[index + 1];
    if (name !== undefined && value !== undefined) (collected[name] ??= []).push(value);
  }
  for (const [name, value] of Object.entries(request.headers)) {
    if (collected[name] !== undefined || value === undefined) continue;
    collected[name] = Array.isArray(value) ? value : [value];
  }
  return collected;
}

export function parseUploadHeaders(headers: DistinctHeaders): {
  contentLengthBytes: number;
  declaredSha256?: string;
} {
  const lengths = headers["content-length"];
  if (lengths?.length !== 1 || !/^[1-9][0-9]*$/.test(lengths[0] ?? "")) {
    throw new AssetImportApiError("VALIDATION_ERROR", "Content-Length must be one positive decimal value.");
  }
  const contentLengthBytes = Number(lengths[0]);
  if (!Number.isSafeInteger(contentLengthBytes)) {
    throw new AssetImportApiError("VALIDATION_ERROR", "Content-Length must be a safe integer.");
  }
  if (contentLengthBytes > ASSET_MANIFEST_LIMITS.maxFileBytes) {
    throw new AssetImportApiError("PAYLOAD_TOO_LARGE", "The declared upload exceeds the per-file limit.");
  }
  const hashes = headers["x-content-sha256"];
  if (hashes !== undefined && hashes.length !== 1) {
    throw new AssetImportApiError("VALIDATION_ERROR", "X-Content-SHA256 must not be repeated.");
  }
  const declaredSha256 = hashes?.[0];
  if (declaredSha256 !== undefined && !Sha256Schema.safeParse(declaredSha256).success) {
    throw new AssetImportApiError("VALIDATION_ERROR", "X-Content-SHA256 must be one lowercase SHA-256 digest.");
  }
  return { contentLengthBytes, ...(declaredSha256 === undefined ? {} : { declaredSha256 }) };
}

function requestData<T>(schema: z.ZodType<T>, input: unknown): T {
  return schema.parse(input);
}

function responseData<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AssetImportApiError("INTERNAL_ERROR", "Asset import response failed contract validation.");
  }
  return parsed.data;
}

async function handle(
  request: FastifyRequest,
  reply: FastifyReply,
  execute: () => Promise<unknown>
): Promise<FastifyReply> {
  try {
    return reply.status(200).send(await execute());
  } catch (error) {
    const normalized = normalizeAssetImportError(error);
    assertAssetErrorPair(normalized);
    return reply.status(normalized.statusCode).send(assetImportErrorEnvelope(normalized, request.id));
  }
}

async function handleBinary(
  request: FastifyRequest,
  reply: FastifyReply,
  execute: () => Promise<{ bytes: Uint8Array; contentType: string; etag: string }>
): Promise<FastifyReply> {
  try {
    const content = await execute();
    return reply
      .status(200)
      .header("content-type", content.contentType)
      .header("content-length", String(content.bytes.byteLength))
      .header("etag", content.etag)
      .header("cache-control", "private, no-store")
      .send(Buffer.from(content.bytes));
  } catch (error) {
    const normalized = normalizeAssetImportError(error);
    assertAssetErrorPair(normalized);
    return reply.status(normalized.statusCode).send(assetImportErrorEnvelope(normalized, request.id));
  }
}

export function registerAssetImportRoutes(
  app: FastifyInstance,
  service: AssetImportApplicationService,
  adminKey: string
): void {
  app.register(async (assetApp) => {
    assetApp.addHook("onRequest", async (request, reply) => {
      try {
        authenticateAssetAdminKey(request.headers["x-admin-key"], adminKey);
      } catch (error) {
        const normalized = normalizeAssetImportError(error);
        return reply.status(normalized.statusCode).send(assetImportErrorEnvelope(normalized, request.id));
      }
    });
    assetApp.setErrorHandler((error, request, reply) => {
      const normalized = normalizeAssetImportError(error);
      return reply.status(normalized.statusCode).send(assetImportErrorEnvelope(normalized, request.id));
    });

    assetApp.post("/sessions", (request, reply) => handle(request, reply, async () =>
      responseData(CreateAssetImportSessionResponseSchema, await service.createSession(
        requestData(CreateAssetImportSessionRequestSchema, request.body)
      ))
    ));
    assetApp.get("/sessions", (request, reply) => handle(request, reply, async () => {
      const raw = request.query as Record<string, unknown>;
      const query = requestData(ListAssetImportSessionsQuerySchema, {
        ...raw,
        ...(typeof raw.limit === "string" ? { limit: Number(raw.limit) } : {})
      });
      return responseData(ListAssetImportSessionsResponseSchema, await service.listSessions(query));
    }));
    assetApp.post("/sessions/:sessionId/cancel", (request, reply) => handle(request, reply, async () => {
      const params = requestData(CancelAssetImportSessionParamsSchema, request.params);
      return responseData(CancelAssetImportSessionResponseSchema, await service.cancelSession(
        params.sessionId, requestData(CancelAssetImportSessionRequestSchema, request.body)
      ));
    }));
    assetApp.post("/sessions/:sessionId/manifest", (request, reply) => handle(request, reply, async () => {
      const params = requestData(RegisterAssetManifestParamsSchema, request.params);
      return responseData(RegisterAssetManifestResponseSchema, await service.registerManifest(
        params.sessionId, requestData(RegisterAssetManifestRequestSchema, request.body)
      ));
    }));
    assetApp.get("/sessions/:sessionId", (request, reply) => handle(request, reply, async () => {
      const params = requestData(SessionParamsSchema, request.params);
      return responseData(AssetImportSessionResponseSchema, await service.getSession(params.sessionId));
    }));
    assetApp.post("/sessions/:sessionId/grouping/start", (request, reply) => handle(request, reply, async () => {
      const params = requestData(StartAssetImportGroupingParamsSchema, request.params);
      return responseData(StartAssetImportGroupingResponseSchema, await service.startGrouping(
        params.sessionId, requestData(StartAssetImportGroupingRequestSchema, request.body)
      ));
    }));
    assetApp.post("/sessions/:sessionId/processing/start", (request, reply) => handle(request, reply, async () => {
      const params = requestData(StartAssetImportProcessingParamsSchema, request.params);
      return responseData(StartAssetImportProcessingResponseSchema, await service.startProcessing(
        params.sessionId, requestData(StartAssetImportProcessingRequestSchema, request.body)
      ));
    }));
    assetApp.patch("/groups/:groupId", (request, reply) => handle(request, reply, async () => {
      const params = requestData(UpdateBeadImageGroupParamsSchema, request.params);
      return responseData(UpdateBeadImageGroupResponseSchema, await service.updateGroup(
        params.groupId, requestData(UpdateBeadImageGroupRequestSchema, request.body)
      ));
    }));
    assetApp.post("/groups/:groupId/reprocess", (request, reply) => handle(request, reply, async () => {
      const params = requestData(ReprocessBeadImageGroupParamsSchema, request.params);
      return responseData(ReprocessBeadImageGroupResponseSchema, await service.reprocessGroup(
        params.groupId, requestData(ReprocessBeadImageGroupRequestSchema, request.body)
      ));
    }));
    assetApp.post("/groups/:groupId/processed-version", (request, reply) => handle(request, reply, async () => {
      const params = requestData(SelectProcessedVersionParamsSchema, request.params);
      return responseData(SelectProcessedVersionResponseSchema, await service.selectProcessedVersion(
        params.groupId, requestData(SelectProcessedVersionRequestSchema, request.body)
      ));
    }));
    assetApp.post("/groups/:groupId/processed-assets/:processedAssetId/review", (request, reply) => handle(request, reply, async () => {
      const params = requestData(ReviewProcessedAssetParamsSchema, request.params);
      return responseData(ReviewProcessedAssetResponseSchema, await service.reviewProcessedAsset(
        params.groupId, params.processedAssetId, requestData(ReviewProcessedAssetRequestSchema, request.body)
      ));
    }));
    assetApp.patch("/crystal-drafts/:crystalDraftId", (request, reply) => handle(request, reply, async () => {
      const params = requestData(UpdateCrystalDraftCurationParamsSchema, request.params);
      return responseData(UpdateCrystalDraftCurationResponseSchema, await service.updateCrystalDraft(
        params.crystalDraftId, requestData(UpdateCrystalDraftCurationRequestSchema, request.body)
      ));
    }));
    assetApp.post("/groups/:groupId/draft", (request, reply) => handle(request, reply, async () => {
      const params = requestData(SaveBeadProductDraftParamsSchema, request.params);
      return responseData(SaveBeadProductDraftResponseSchema, await service.saveGroupDraft(
        params.groupId, requestData(SaveBeadProductDraftRequestSchema, request.body)
      ));
    }));
    assetApp.get("/groups/:groupId/draft-completeness", (request, reply) => handle(request, reply, async () => {
      const params = requestData(CheckBeadProductDraftCompletenessParamsSchema, request.params);
      return responseData(CheckBeadProductDraftCompletenessResponseSchema, await service.checkGroupDraftCompleteness(params.groupId));
    }));
    assetApp.post("/groups/:groupId/publish", (request, reply) => handle(request, reply, async () => {
      const params = requestData(PublishBeadImageGroupParamsSchema, request.params);
      return responseData(PublishBeadImageGroupResponseSchema, await service.publishGroup(
        params.groupId, requestData(PublishBeadImageGroupRequestSchema, request.body)
      ));
    }));
    assetApp.get("/groups/:groupId/publish-result", (request, reply) => handle(request, reply, async () => {
      const params = requestData(GetBeadImageGroupPublishResultParamsSchema, request.params);
      return responseData(GetBeadImageGroupPublishResultResponseSchema, await service.getPublishResult(params.groupId));
    }));

    assetApp.get("/files/:fileId/content", (request, reply) => handleBinary(request, reply, async () => {
      const params = requestData(AssetFileContentParamsSchema, request.params);
      return service.readSourceFile(params.fileId);
    }));
    assetApp.get("/processed-assets/:processedAssetId/content", (request, reply) => handleBinary(request, reply, async () => {
      const params = requestData(ProcessedAssetContentParamsSchema, request.params);
      const query = requestData(ProcessedAssetContentQuerySchema, request.query as Record<string, unknown>);
      return service.readProcessedAsset(params.processedAssetId, query.rendition ?? "main");
    }));
    assetApp.get("/crystals", (request, reply) => handle(request, reply, async () => {
      const raw = request.query as Record<string, unknown>;
      const query = requestData(ListCrystalsQuerySchema, {
        ...raw,
        ...(typeof raw.limit === "string" ? { limit: Number(raw.limit) } : {})
      });
      return responseData(ListCrystalsResponseSchema, await service.searchCrystals(query));
    }));

    assetApp.register(async (uploadApp) => {
      uploadApp.removeAllContentTypeParsers();
      uploadApp.addContentTypeParser("*", (_request, payload, done) => done(null, payload));
      uploadApp.addHook("onRequest", async (request) => {
        const transport = parseUploadHeaders(distinctRequestHeaders(request));
        const path = requestData(UploadPathParamsSchema, request.params);
        validatedUploadParams.set(request, requestData(UploadAssetFileParamsSchema, { ...path, ...transport }));
      });
      uploadApp.put("/sessions/:sessionId/files/:fileId/content", {
        bodyLimit: ASSET_MANIFEST_LIMITS.maxFileBytes
      }, (request, reply) => handle(request, reply, async () => {
        const params = validatedUploadParams.get(request);
        if (params === undefined) {
          throw new AssetImportApiError("INTERNAL_ERROR", "Upload request validation did not complete.");
        }
        return responseData(UploadAssetFileResponseSchema, await service.uploadFile(params, request.body as Readable));
      }));
    });
  }, { prefix: "/api/admin/bead-import" });
}
