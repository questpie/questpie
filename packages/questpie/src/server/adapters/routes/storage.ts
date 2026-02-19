/**
 * Storage Routes
 *
 * File upload and serving route handlers.
 */

import type { Questpie } from "../../config/questpie.js";
import type { QuestpieConfig, StorageVisibility } from "../../config/types.js";
import { ApiError } from "../../errors/index.js";
import { verifySignedUrlToken } from "../../integrated/storage/signed-url.js";
import type { AdapterConfig, AdapterContext, UploadFile } from "../types.js";
import { resolveContext } from "../utils/context.js";
import { resolveUploadFile } from "../utils/request.js";
import { handleError, smartResponse } from "../utils/response.js";

export const createStorageRoutes = <
  TConfig extends QuestpieConfig = QuestpieConfig,
>(app: Questpie<TConfig>,
  config: AdapterConfig<TConfig> = {},
) => {
  const errorResponse = (
    error: unknown,
    request: Request,
    locale?: string,
  ): Response => {
    return handleError(error, { request, app, locale });
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
        collectionConfig = app.getCollectionConfig(collection as any);
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

      const resolved = await resolveContext(app, request, config, context);
      const uploadFile = await resolveUploadFile(request, file);

      if (!uploadFile) {
        return errorResponse(
          ApiError.badRequest("No file uploaded. Send 'file' in form-data."),
          request,
          resolved.appContext.locale,
        );
      }

      try {
        // Use the collection's upload method which handles validation and storage
        const crud = app.api.collections[collection as any] as any;
        if (!crud?.upload) {
          return errorResponse(
            ApiError.badRequest(
              `Collection "${collection}" upload method not available`,
            ),
            request,
            resolved.appContext.locale,
          );
        }

        const result = await crud.upload(uploadFile, resolved.appContext);
        return smartResponse(result, request);
      } catch (error) {
        return errorResponse(error, request, resolved.appContext.locale);
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
        collectionConfig = app.getCollectionConfig(collection as any);
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
      const exists = await app.storage.use().exists(key);
      if (!exists) {
        return errorResponse(ApiError.notFound("File", key), request);
      }

      // Get record metadata to check visibility
      const crud = app.api.collections[collection as any];
      const record = await crud.findOne({
        where: { key } as any,
      });

      const visibility: StorageVisibility =
        (record as any)?.visibility ||
        app.config.storage?.defaultVisibility ||
        "public";

      // For private files, verify the signed token
      if (visibility === "private") {
        if (!token) {
          return errorResponse(
            ApiError.unauthorized("Token required for private files"),
            request,
          );
        }

        const secret = app.config.secret;
        if (!secret) {
          return errorResponse(
            ApiError.internal(
              "Storage secret not configured. Set 'secret' in your app config to serve private files.",
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
        const fileBuffer = await app.storage.use().getBytes(key);
        const metadata = await app.storage.use().getMetaData(key);

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
