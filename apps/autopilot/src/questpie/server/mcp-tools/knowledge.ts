import { ApiError } from "questpie/errors";
import { z } from "zod";

import { mcpTool } from "@questpie/mcp";

import {
	knowledgeScope,
	knowledgeWhere,
	mcpJson,
	requireMcpCaller,
} from "../lib/mcp-tool-helpers";

const scopeSchema = {
	scope_type: z.enum(["company", "project", "task"]).optional(),
	scope_id: z.string().optional(),
	project_id: z.string().optional(),
	task_id: z.string().optional(),
};

const listSchema = z.object({
	path: z.string().optional().describe("Optional path prefix"),
	...scopeSchema,
});

const readSchema = z.object({
	path: z.string().min(1).describe("Knowledge path"),
	...scopeSchema,
});

const writeSchema = z.object({
	path: z.string().min(1).describe("Knowledge path"),
	content: z.string().describe("Document content"),
	title: z.string().optional(),
	mime_type: z.string().optional(),
	...scopeSchema,
});

const deleteSchema = z.object({
	path: z.string().min(1).describe("Knowledge path"),
	...scopeSchema,
});

const searchSchema = z.object({
	query: z.string().min(1).describe("Search query"),
	...scopeSchema,
});

export const knowledgeList = mcpTool("knowledge_list", {
	title: "List knowledge",
	description: "List knowledge resources by path and scope.",
	inputSchema: listSchema,
	annotations: { readOnlyHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const { path, ...scopeInput } = input;
	const result = await ctx.collections.knowledge.find({
		where: knowledgeWhere(scopeInput),
		limit: 500,
		orderBy: { path: "asc" },
	});
	const docs = path
		? result.docs.filter((doc: { path?: string | null }) =>
				doc.path?.startsWith(path),
			)
		: result.docs;

	return mcpJson(docs);
});

export const knowledgeRead = mcpTool("knowledge_read", {
	title: "Read knowledge",
	description: "Read a knowledge resource by path and scope.",
	inputSchema: readSchema,
	annotations: { readOnlyHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const resource = await ctx.collections.knowledge.findOne({
		where: knowledgeWhere(input),
	});
	if (!resource) throw ApiError.notFound("Knowledge", input.path);
	return mcpJson(resource);
});

export const knowledgeWrite = mcpTool("knowledge_write", {
	title: "Write knowledge",
	description: "Create or update a knowledge resource.",
	inputSchema: writeSchema,
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const scope = knowledgeScope(input);
	const existing = await ctx.collections.knowledge.findOne({
		where: knowledgeWhere({ ...input, path: input.path }),
	});

	const data = {
		title: input.title ?? input.path.split("/").at(-1) ?? input.path,
		path: input.path,
		body: input.content,
		contentType: input.mime_type ?? "text/markdown",
		scopeType: scope.scopeType,
		project: scope.projectId,
		task: scope.taskId,
		kind: "document",
		source: "mcp",
		sourceRef: ctx.session?.user?.id ?? "mcp",
	};

	const resource = existing
		? await ctx.collections.knowledge.updateById({
				id: existing.id,
				data,
			})
		: await ctx.services.knowledgeResource.createTextResource({
				title: data.title,
				path: data.path,
				body: data.body,
				contentType: data.contentType,
				scopeType: data.scopeType,
				projectId: data.project,
				taskId: data.task,
				kind: "document",
				source: "mcp",
				sourceRef: data.sourceRef,
			});

	return mcpJson(resource);
});

export const knowledgeDelete = mcpTool("knowledge_delete", {
	title: "Delete knowledge",
	description: "Delete a knowledge resource by path and scope.",
	inputSchema: deleteSchema,
	annotations: { destructiveHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const resource = await ctx.collections.knowledge.findOne({
		where: knowledgeWhere(input),
	});
	if (!resource) return mcpJson({ deleted: false });

	await ctx.collections.knowledge.deleteById({ id: resource.id });
	return mcpJson({ deleted: true, id: resource.id });
});

export const knowledgeSearch = mcpTool("knowledge_search", {
	title: "Search knowledge",
	description: "Search knowledge titles, paths, and bodies.",
	inputSchema: searchSchema,
	annotations: { readOnlyHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const result = await ctx.collections.knowledge.find({
		where: knowledgeWhere(input),
		limit: 50,
		orderBy: { updatedAt: "desc" },
	});
	return mcpJson(result.docs);
});
