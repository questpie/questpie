/**
 * Format-agnostic file-as-DB API for Knowledge mini-apps.
 *
 * `/api/apps/{appId}/fs/[...path]` reads/writes/lists raw bytes under the app's
 * scoped data dir `company/apps/{appId}/data/`. Content-type is metadata only —
 * the app picks its own format (md/json/csv/sqlite/custom); no format logic
 * lives here.
 *
 *  - `GET  …/fs/<file>`            → file bytes/text with stored content-type.
 *  - `GET  …/fs/<dir>` / `?list`   → JSON listing of entries under the dir.
 *  - `PUT  …/fs/<file>`            → create/overwrite from the request body +
 *                                    content-type. (No DELETE in MVP.)
 *
 * The literal `fs` segment gives this route trie priority over the future
 * named-endpoint route (`apps/[appId]/[fn]`).
 *
 * Design: `.private/knowledge-miniapps-mvp.md` §8 (M6), §9 (decision 4),
 * §11 (decision 5).
 */

import { ApiError } from "questpie/errors";

import {
	appDataPrefix,
	decodeStoredBody,
	encodeBodyForStorage,
	resolveAppDataPath,
} from "../../../../apps/app-fs";
import {
	fsPseudoAction,
	miniAppTokenAccess,
} from "../../../../lib/route-access";

/**
 * Access for the file-as-DB bridge route: an authenticated admin AND a valid
 * `x-miniapp-token` bound to `{appId, session, user}` whose allowlist grants the
 * `fs:read` (GET) / `fs:write` (PUT) pseudo-action (§3.3). REPLACES the old
 * `sessionOnly`.
 */
export const miniAppFsAccess = miniAppTokenAccess(fsPseudoAction);

export type FsContext = Questpie.AppContext & {
	request: Request;
	params: { appId: string; path: string };
};

/** Whether the request is asking for a directory listing rather than a file. */
function isListRequest(
	url: URL,
	scopedPath: string,
	dataPrefix: string,
): boolean {
	if (url.searchParams.has("list")) return true;
	// The data root itself, or any trailing-slash path, is a directory.
	return scopedPath === dataPrefix.slice(0, -1) || scopedPath.endsWith("/");
}

async function handleList(ctx: FsContext, prefix: string) {
	const entries = await ctx.services.knowledgeResource.listByPrefix(prefix);
	return Response.json({ prefix, entries });
}

export async function handleFsGet(ctx: FsContext, url: URL) {
	const { appId, path } = ctx.params;
	const dataPrefix = appDataPrefix(appId);
	const scopedPath = resolveAppDataPath(appId, path);

	if (isListRequest(url, scopedPath, dataPrefix)) {
		// Normalize the listing prefix so `dir` and `dir/` behave the same.
		const listPrefix = scopedPath.endsWith("/") ? scopedPath : `${scopedPath}/`;
		return handleList(ctx, listPrefix);
	}

	const resource = await ctx.services.knowledgeResource.readByPath(scopedPath);
	if (resource) {
		const bytes = decodeStoredBody(resource.body, resource.metadata);
		return new Response(bytes, {
			headers: {
				"content-type": resource.contentType ?? "application/octet-stream",
			},
		});
	}

	// No file at the exact path — if it's a non-empty directory prefix, list it
	// (so `GET …/fs/<dir>` works without an explicit `?list` / trailing slash).
	const listPrefix = `${scopedPath}/`;
	const entries = await ctx.services.knowledgeResource.listByPrefix(listPrefix);
	if (entries.length > 0) {
		return Response.json({ prefix: listPrefix, entries });
	}

	throw ApiError.notFound("File", path);
}

export async function handleFsPut(ctx: FsContext) {
	const { appId, path } = ctx.params;
	const scopedPath = resolveAppDataPath(appId, path);
	if (scopedPath.endsWith("/")) {
		throw ApiError.badRequest("Cannot PUT a directory path");
	}

	const contentType =
		ctx.request.headers.get("content-type") ?? "application/octet-stream";
	const bytes = new Uint8Array(await ctx.request.arrayBuffer());
	const { body, encoding } = encodeBodyForStorage(bytes, contentType);

	const saved = await ctx.services.knowledgeResource.writeByPath({
		path: scopedPath,
		body,
		contentType,
		scopeType: "company",
		kind: "document",
		source: "system",
		sourceRef: `app:${appId}`,
		metadata: { app: appId, encoding },
	});

	return Response.json(
		{
			path: saved.path,
			contentType: saved.contentType,
			size: bytes.byteLength,
		},
		{ status: 201 },
	);
}
