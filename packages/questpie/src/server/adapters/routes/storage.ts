/**
 * Storage Routes
 *
 * File upload and serving route handlers.
 */

import type { Questpie } from "../../config/cms.js";
import type { QuestpieConfig, StorageVisibility } from "../../config/types.js";
import { ApiError } from "../../errors/index.js";
import { verifySignedUrlToken } from "../../integrated/storage/signed-url.js";
import type { AdapterConfig, AdapterContext, UploadFile } from "../types.js";
import { resolveContext } from "../utils/context.js";
import { resolveUploadFile } from "../utils/request.js";
import { handleError, smartResponse } from "../utils/response.js";

export const createStorageRoutes = <
  TConfig extends QuestpieConfig = QuestpieConfig,
>(
  cms: Questpie<TConfig>,
  config: AdapterConfig<TConfig> = {},
) => {
  const errorResponse = (
    error: unknown,
    request: Request,
    locale?: string,
  ): Response => {
    return handleError(error, { request, cms, locale });
  };

  return {
    collectionUpload: async (
      request: Request,
      params: { collection: string },
      context?: AdapterContext,
      file?: UploadFile | null,
    ): Promise<Response> => {
      if (request.method !== "POST") {
        return errorResponse(
          ApiError.badRequest("Method not allowed"),
          request,
        );
      }

      const { collection } = params;

      // Check if collection exists and has upload configured
      let collectionConfig: any;
      try {
        collectionConfig = cms.getCollectionConfig(collection as any);
      } catch {
        return errorResponse(
          ApiError.notFound("Collection", collection),
          request,
        );
      }

      // Check if upload is enabled for this collection
      if (!collectionConfig.state?.upload) {
        return errorResponse(
          ApiError.badRequest(
            `Collection "${collection}" does not support file uploads. Use .upload() to enable.`,
          ),
          request,
        );
      }

      const resolved = await resolveContext(cms, request, config, context);
      const uploadFile = await resolveUploadFile(request, file);

      if (!uploadFile) {
        return errorResponse(
          ApiError.badRequest("No file uploaded. Send 'file' in form-data."),
          request,
          resolved.cmsContext.locale,
        );
      }

      try {
        // Use the collection's upload method which handles validation and storage
        const crud = cms.api.collections[collection as any] as any;
        if (!crud?.upload) {
          return errorResponse(
            ApiError.badRequest(
              `Collection "${collection}" upload method not available`,
            ),
            request,
            resolved.cmsContext.locale,
          );
        }

        const result = await crud.upload(uploadFile, resolved.cmsContext);
        return smartResponse(result, request);
      } catch (error) {
        return errorResponse(error, request, resolved.cmsContext.locale);
      }
    },

    collectionServe: async (
      request: Request,
      params: { collection: string; key: string },
      _context?: AdapterContext,
    ): Promise<Response> => {
      if (request.method !== "GET") {
        return errorResponse(
          ApiError.badRequest("Method not allowed"),
          request,
        );
      }

      const { collection, key } = params;

      // Check if collection exists and has upload configured
      let collectionConfig: any;
      try {
        collectionConfig = cms.getCollectionConfig(collection as any);
      } catch {
        return errorResponse(
          ApiError.notFound("Collection", collection),
          request,
        );
      }

      // Check if upload is enabled for this collection
      if (!collectionConfig.state?.upload) {
        return errorResponse(
          ApiError.badRequest(
            `Collection "${collection}" does not support file serving. Use .upload() to enable.`,
          ),
          request,
        );
      }

      const url = new URL(request.url);
      const token = url.searchParams.get("token");

      // Check if file exists
      const exists = await cms.storage.use().exists(key);
      if (!exists) {
        return errorResponse(ApiError.notFound("File", key), request);
      }

      // Get record metadata to check visibility
      const crud = cms.api.collections[collection as any];
      const record = await crud.findOne({
        where: { key } as any,
      });

      const visibility: StorageVisibility =
        (record as any)?.visibility ||
        cms.config.storage?.defaultVisibility ||
        "public";

      // For private files, verify the signed token
      if (visibility === "private") {
        if (!token) {
          return errorResponse(
            ApiError.unauthorized("Token required for private files"),
            request,
          );
        }

        const secret = cms.config.secret;
        if (!secret) {
          return errorResponse(
            ApiError.internal(
              "Storage secret not configured. Set 'secret' in your CMS config to serve private files.",
            ),
            request,
          );
        }
        const payload = await verifySignedUrlToken(token, secret);

        if (!payload) {
          return errorResponse(
            ApiError.unauthorized("Invalid or expired token"),
            request,
          );
        }

        if (payload.key !== key) {
          return errorResponse(
            ApiError.unauthorized("Token does not match requested file"),
            request,
          );
        }
      }

      try {
        const fileBuffer = await cms.storage.use().getBytes(key);
        const metadata = await cms.storage.use().getMetaData(key);

        const contentType =
          metadata.contentType ||
          (record as any)?.mimeType ||
          "application/octet-stream";

        // Sanitize filename to prevent header injection
        const rawFilename = (record as any)?.filename;
        const sanitizedFilename = rawFilename
          ? rawFilename.replace(/[\r\n"\\]/g, "_")
          : null;

        return new Response(fileBuffer.buffer as ArrayBuffer, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(fileBuffer.byteLength),
            "Cache-Control":
              visibility === "public"
                ? "public, max-age=31536000, immutable"
                : "private, no-cache",
            ...(sanitizedFilename && {
              "Content-Disposition": `inline; filename="${sanitizedFilename}"`,
            }),
          },
        });
      } catch (error) {
        return errorResponse(error, request);
      }
    },
  };
};
