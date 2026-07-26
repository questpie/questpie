import { z } from "zod";

import { createClient } from "../../src/client/index.js";
import { collection, global } from "../../src/exports/index.js";
import type {
	CrdtClientAPI,
	CrdtRegistryFromApp,
	CrdtServerAPI,
} from "../../src/server/modules/core/integrated/crdt/types.js";
import type { Equal, Expect } from "./type-test-utils.js";

const awareness = z.object({
	name: z.string(),
});
const articles = collection("articles")
	.fields(({ f }) => ({
		title: f
			.text({ mode: "text" })
			.default("")
			.required()
			.crdt({ format: "text" }),
		tags: f
			.text({ mode: "text" })
			.array()
			.default([])
			.required()
			.crdt({ format: "set", conflict: "add-wins" }),
		content: f.textarea().default("").required().crdt({ format: "text" }),
		status: f
			.select([
				{ label: "Draft", value: "draft" },
				{ label: "Published", value: "published" },
			])
			.default("draft"),
	}))
	.collaborative({ awareness });
const siteSettings = global("site-settings")
	.fields(({ f }) => ({
		content: f.textarea().default("").required().crdt({ format: "text" }),
	}))
	.collaborative();
const plain = collection("plain");

type Registry = CrdtRegistryFromApp<{
	collections: {
		articles: typeof articles;
		plain: typeof plain;
	};
	globals: { siteSettings: typeof siteSettings };
}>;

type _collectionKeys = Expect<Equal<keyof Registry["collections"], "articles">>;
type _fieldKeys = Expect<
	Equal<
		keyof Registry["collections"]["articles"]["fields"],
		"title" | "tags" | "content"
	>
>;
type _awareness = Expect<
	Equal<
		Registry["collections"]["articles"]["awareness"],
		z.output<typeof awareness>
	>
>;
type _globalAwarenessDisabled = Expect<
	Equal<Registry["globals"]["siteSettings"]["awareness"], never>
>;

const createSeed: (typeof articles)["$infer"]["insert"] = {
	title: "Title",
	tags: ["tag-1"],
	content: "Body",
	status: "draft",
};
const ordinaryUpdate: (typeof articles)["$infer"]["update"] = {
	status: "published",
};
const invalidOrdinaryUpdate: (typeof articles)["$infer"]["update"] = {
	// @ts-expect-error CRDT fields are seedable on create but absent from update
	content: "replace",
};
const invalidGlobalUpdate: (typeof siteSettings)["$infer"]["update"] = {
	// @ts-expect-error global CRDT fields are absent from ordinary update
	content: "replace",
};
void createSeed;
void ordinaryUpdate;
void invalidOrdinaryUpdate;
void invalidGlobalUpdate;

declare const client: CrdtClientAPI<Registry>;
const article = client.collections.articles.document({ id: "article-1" });
article.fields.title.text.value();
article.fields.title.text.apply([
	{ type: "insert", index: 0, value: "Shared " },
]);
article.fields.tags.set.add("tag-1");
article.fields.tags.set.delete("tag-1");
article.fields.content.text.apply([{ type: "delete", index: 0, length: 1 }]);
const clientAnchor = article.fields.title.anchors.create({
	kind: "range",
	start: 0,
	end: 1,
});
article.fields.title.anchors.resolve(clientAnchor);
article.transaction(({ fields }) => {
	fields.title.text.apply([{ type: "insert", index: 0, value: "New " }]);
	fields.tags.set.add("tag-2");
});
article.awareness.set(
	{ name: "Ada" },
	{ activeField: "title", cursor: 0, selectionEnd: 1 },
);
// @ts-expect-error activity keys are reserved for the typed second argument
article.awareness.set({ name: "Ada", activeField: "title" });
article.export();
article.discard();

const settings = client.globals.siteSettings.document();
type _globalAwarenessPort = Expect<
	Equal<typeof settings.awareness, { readonly enabled: false }>
>;

// @ts-expect-error non-CRDT fields are absent
void article.fields.status;
// @ts-expect-error phantom owners are absent
void client.collections.plain;
// @ts-expect-error collection documents require an id
client.collections.articles.document();
// @ts-expect-error globals never take a locator
client.globals.siteSettings.document({ id: "nope" });
// @ts-expect-error set ports do not expose text operations
void article.fields.tags.text;
// @ts-expect-error text ports do not expose set operations
void article.fields.title.set;
// @ts-expect-error set ports do not expose text anchors
void article.fields.tags.anchors;
// @ts-expect-error no-arg collaborative owners have awareness disabled
settings.awareness.set({});

const generatedClient = createClient<{
	collections: {
		articles: typeof articles;
		plain: typeof plain;
	};
	globals: { siteSettings: typeof siteSettings };
	crdt: Registry;
}>({
	baseURL: "https://example.com",
	crdt: {},
});
generatedClient.crdt.collections.articles
	.document({ id: "article-1" })
	.fields.tags.set.add("tag-3");
const generatedArticle = generatedClient.crdt.collections.articles.document({
	id: "article-1",
});
// @ts-expect-error createClient<AppConfig>() must not expose non-CRDT fields
void generatedArticle.fields.status;

createClient({
	baseURL: "https://example.com",
	crdt: {
		// @ts-expect-error the server-issued open response owns the authorized manifest
		manifest: {},
	},
});
createClient({
	baseURL: "https://example.com",
	crdt: {
		// @ts-expect-error the server-issued open response owns the offline subject key
		getSubject: () => "user-1",
	},
});
createClient({
	baseURL: "https://example.com",
	crdt: {
		// @ts-expect-error namespace is server-issued, never client-configured
		namespace: "app",
	},
});

declare const server: CrdtServerAPI<Registry>;
const serverArticle = server.collections.articles.document({ id: "article-1" });
const titleStatus = serverArticle.fields.title.status();
type _titleFormat = Expect<
	Equal<Awaited<typeof titleStatus>["format"], "text">
>;
const tagStatus = serverArticle.fields.tags.status();
type _tagFormat = Expect<Equal<Awaited<typeof tagStatus>["format"], "set">>;
const serverAnchor = serverArticle.fields.title.anchors.create({
	kind: "point",
	offset: 1,
});
serverArticle.fields.title.anchors.resolve("opaque-token");
// @ts-expect-error set fields do not expose text anchors
void serverArticle.fields.tags.anchors;
void serverAnchor;

serverArticle.fields.title.replace({
	value: "replacement",
	expected: { fieldEpoch: "1", canonicalRevision: "2" },
	reason: "import",
});
serverArticle.replace({
	fields: {
		title: "Title",
		tags: ["tag-1"],
		content: "Body",
	},
	expected: {
		aggregateEpoch: "1",
		canonicalRevisions: {
			title: "2",
			tags: "3",
			content: "4",
		},
	},
	reason: "restore",
});
serverArticle.fields.tags.authorityTarget({
	subject: { kind: "agent", issuer: "https://agents.example", subjectId: "a1" },
	capability: "edit",
});
serverArticle.authorityTarget({
	subject: { kind: "human", subjectId: "u1" },
	capability: "read",
});

server.globals.siteSettings.document().fields.content.replace({
	value: "replacement",
	expected: { fieldEpoch: "1", canonicalRevision: "2" },
	reason: "agent",
});

serverArticle.replace({
	// @ts-expect-error aggregate replace requires every collaborative field
	fields: { title: "Only title" },
	expected: {
		aggregateEpoch: "1",
		// @ts-expect-error aggregate replace requires every canonical revision
		canonicalRevisions: { title: "2" },
	},
	reason: "import",
});
serverArticle.fields.title.replace({
	value: "replacement",
	expected: { fieldEpoch: "1", canonicalRevision: "2" },
	// @ts-expect-error exact replacement reasons only
	reason: "manual",
});
serverArticle.fields.title.authorityTarget({
	// @ts-expect-error Agent authority subjects require stable issuer
	subject: { kind: "agent", subjectId: "a1" },
	capability: "edit",
});
// @ts-expect-error phantom/non-CRDT fields are absent
void serverArticle.fields.status;
