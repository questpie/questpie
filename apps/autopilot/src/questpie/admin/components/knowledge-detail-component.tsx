"use client";

import { Icon } from "@iconify/react";
import * as React from "react";

import {
	AdminLink,
	AdminViewHeader,
	AdminViewLayout,
	useCollectionItem,
	type CollectionFormViewProps,
	type MaybeLazyComponent,
} from "@questpie/admin/client";
import { adminClientModule } from "@questpie/admin/client/modules/admin";

import {
	dispatchChatAttachment,
	setChatAttachmentDragData,
} from "../lib/chat-attachments";
import {
	createKnowledgeChatAttachment,
	knowledgeMetadataEntries,
	knowledgeSourceLine,
	knowledgeSummary,
} from "../lib/knowledge-attachments";
import { KnowledgeHost } from "./knowledge-host";

type KnowledgeDoc = {
	id: string;
	title?: string | null;
	path?: string | null;
	kind?: string | null;
	contentType?: string | null;
	body?: string | null;
	renderer?: string | null;
	source?: string | null;
	sourceRef?: string | null;
	scopeType?: string | null;
	/** Upload-blob fields (present when the row carries an uploaded file). */
	url?: string | null;
	key?: string | null;
	filename?: string | null;
	project?: RelationValue;
	task?: RelationValue;
	run?: RelationValue;
	metadata?: unknown;
	createdAt?: string | Date | null;
	updatedAt?: string | Date | null;
};

type RelationValue =
	| string
	| { id?: string; title?: string; name?: string }
	| null;

function isLazyLoader(loader: MaybeLazyComponent): loader is () => Promise<{
	default: React.ComponentType<Record<string, unknown>>;
}> {
	return (
		typeof loader === "function" &&
		loader.length === 0 &&
		!("prototype" in loader && loader.prototype?.isReactComponent)
	);
}

const CollectionFormView = React.lazy(async () => {
	const loader = adminClientModule.views["collection-form"].component;
	if (isLazyLoader(loader)) {
		const module = await loader();
		return {
			default: (module.default ?? module) as React.ComponentType<
				Record<string, unknown>
			>,
		};
	}
	return {
		default: loader as React.ComponentType<Record<string, unknown>>,
	};
});

function relationId(value: RelationValue): string | null {
	if (typeof value === "string") return value;
	return value?.id ?? null;
}

function relationLabel(value: RelationValue, fallback: string): string {
	if (typeof value === "string") return value;
	return value?.title ?? value?.name ?? value?.id ?? fallback;
}

function formatDate(value: KnowledgeDoc["createdAt"]) {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	if (!Number.isFinite(date.getTime())) return null;
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

function metadataValue(value: unknown) {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function looksHtml(doc: KnowledgeDoc) {
	const contentType = doc.contentType?.toLowerCase() ?? "";
	return (
		doc.renderer === "html" ||
		contentType.includes("html") ||
		/\.html?$/i.test(doc.path ?? "")
	);
}

/**
 * A row is a mini-app when its `kind`/`renderer` says so. The `.app` bundle is a
 * SUBTREE; any of its rows (`server.ts`/`index.html`/`*.jsx`) carries
 * `kind:"miniapp"`, so opening ANY of them resolves to the same app id and mounts
 * the KnowledgeHost for the whole bundle.
 */
function isMiniApp(doc: KnowledgeDoc) {
	return doc.kind === "miniapp" || doc.renderer === "miniapp";
}

/**
 * Extract the `{appId}` from a `.app` bundle row path:
 * `company/apps/{appId}.app/...` → `{appId}`. Returns `null` when the path is not
 * inside an `.app` bundle.
 */
function appIdFromPath(path: string | null | undefined): string | null {
	if (typeof path !== "string") return null;
	const match = path.match(/(?:^|\/)apps\/([a-z0-9][a-z0-9-]*)\.app\//);
	return match ? match[1] : null;
}

/** PDF detection (content-type or extension) → the in-browser pdf viewer. */
function looksPdf(doc: KnowledgeDoc) {
	const contentType = doc.contentType?.toLowerCase() ?? "";
	return (
		doc.renderer === "pdf" ||
		contentType.includes("pdf") ||
		/\.pdf$/i.test(doc.path ?? "")
	);
}

/** Office-document detection (doc/docx/xls/xlsx/ppt/pptx) → the office viewer. */
function looksOffice(doc: KnowledgeDoc) {
	const contentType = doc.contentType?.toLowerCase() ?? "";
	return (
		doc.renderer === "office" ||
		/officedocument|msword|ms-excel|ms-powerpoint/.test(contentType) ||
		/\.(docx?|xlsx?|pptx?)$/i.test(doc.path ?? "")
	);
}

/** A row that carries an uploaded blob (a `key`) rather than a text `body`. */
function hasUploadBlob(doc: KnowledgeDoc) {
	return typeof (doc as { key?: unknown }).key === "string";
}

function bodyKind(doc: KnowledgeDoc) {
	const contentType = doc.contentType?.toLowerCase() ?? "";
	if (isMiniApp(doc)) return "miniapp";
	if (looksPdf(doc)) return "pdf";
	if (looksOffice(doc)) return "office";
	if (looksHtml(doc)) return "html";
	if (
		doc.renderer === "markdown" ||
		contentType.includes("markdown") ||
		/\.mdx?$/i.test(doc.path ?? "")
	) {
		return "markdown";
	}
	return "text";
}

function MarkdownPreview({ body }: { body: string }) {
	const blocks = body.split(/(```[\s\S]*?```)/g);
	return (
		<div className="space-y-3">
			{blocks.map((block, index) => {
				const fence = block.match(/^```([\w-]*)\n?([\s\S]*?)```$/);
				if (fence) {
					return (
						<pre
							key={index}
							className="bg-muted/60 border-border-subtle max-h-[38rem] overflow-auto border p-3 text-xs leading-relaxed"
						>
							<code>{fence[2]}</code>
						</pre>
					);
				}

				return block
					.split(/\n{2,}/)
					.filter((part) => part.trim())
					.map((part, partIndex) => (
						<MarkdownBlock key={`${index}-${partIndex}`} value={part} />
					));
			})}
		</div>
	);
}

function MarkdownBlock({ value }: { value: string }) {
	const trimmed = value.trim();
	const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
	if (heading) {
		const level = heading[1].length;
		const className = "text-foreground mt-4 text-sm font-semibold first:mt-0";
		if (level === 1) return <h2 className={className}>{heading[2]}</h2>;
		if (level === 2) return <h3 className={className}>{heading[2]}</h3>;
		if (level === 3) return <h4 className={className}>{heading[2]}</h4>;
		return <h5 className={className}>{heading[2]}</h5>;
	}

	const lines = trimmed.split("\n");
	if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
		return (
			<ul className="text-foreground list-disc space-y-1 pl-5 text-sm leading-relaxed">
				{lines.map((line, index) => (
					<li key={index}>{line.replace(/^\s*[-*]\s+/, "")}</li>
				))}
			</ul>
		);
	}

	if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
		return (
			<ol className="text-foreground list-decimal space-y-1 pl-5 text-sm leading-relaxed">
				{lines.map((line, index) => (
					<li key={index}>{line.replace(/^\s*\d+\.\s+/, "")}</li>
				))}
			</ol>
		);
	}

	return (
		<p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
			{trimmed}
		</p>
	);
}

/** Resolve a same-origin-friendly blob URL for an upload row (or undefined). */
function resolveBlobUrl(doc: KnowledgeDoc): string | undefined {
	const url = doc.url;
	if (typeof url !== "string" || url.trim().length === 0) return undefined;
	return url.trim();
}

function DownloadFallback({ doc }: { doc: KnowledgeDoc }) {
	const url = resolveBlobUrl(doc);
	const name = doc.filename ?? doc.title ?? doc.path ?? "file";
	return (
		<div className="border-border-subtle bg-card flex flex-col items-center justify-center gap-3 border px-4 py-12 text-center">
			<Icon
				icon="ph:file-arrow-down"
				className="text-muted-foreground size-8"
			/>
			<div className="text-sm font-medium">{name}</div>
			{doc.contentType ? (
				<div className="text-muted-foreground text-xs">{doc.contentType}</div>
			) : null}
			{url ? (
				<a
					href={url}
					download={doc.filename ?? undefined}
					className="control-surface text-foreground inline-flex h-8 items-center gap-2 px-3 text-xs"
				>
					<Icon icon="ph:download-simple" className="size-3.5" />
					Download
				</a>
			) : (
				<div className="text-muted-foreground text-xs">
					No downloadable file on this record.
				</div>
			)}
		</div>
	);
}

function BodyPreview({ doc }: { doc: KnowledgeDoc }) {
	const kind = bodyKind(doc);

	// Mini-app: mount the KnowledgeHost iframe runtime (it reads the `.app` bundle
	// itself — no `body` on the opened row is required).
	if (kind === "miniapp") {
		const appId = appIdFromPath(doc.path);
		if (!appId) {
			return (
				<div className="text-muted-foreground border-border-subtle border px-4 py-8 text-center text-sm">
					This mini-app row is not inside a `.app` bundle path.
				</div>
			);
		}
		return (
			<div className="border-border-subtle bg-background overflow-hidden border">
				<KnowledgeHost appId={appId} className="h-[36rem] w-full" />
			</div>
		);
	}

	// PDF: browsers render application/pdf natively in an <iframe>.
	if (kind === "pdf") {
		const url = resolveBlobUrl(doc);
		if (!url) return <DownloadFallback doc={doc} />;
		return (
			<div className="border-border-subtle bg-background overflow-hidden border">
				<iframe
					title={doc.title ?? doc.path ?? "PDF preview"}
					src={url}
					className="h-[40rem] w-full bg-white"
				/>
			</div>
		);
	}

	// Office docs: embed via the Microsoft Office Online viewer when the blob is at
	// a publicly reachable absolute URL; otherwise fall back to download.
	if (kind === "office") {
		const url = resolveBlobUrl(doc);
		const isAbsolute = !!url && /^https?:\/\//i.test(url);
		if (url && isAbsolute) {
			const viewer = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(
				url,
			)}`;
			return (
				<div className="space-y-2">
					<div className="border-border-subtle bg-background overflow-hidden border">
						<iframe
							title={doc.title ?? doc.path ?? "Document preview"}
							src={viewer}
							className="h-[40rem] w-full bg-white"
						/>
					</div>
					<DownloadFallback doc={doc} />
				</div>
			);
		}
		return <DownloadFallback doc={doc} />;
	}

	const body = doc.body ?? "";
	if (!body.trim()) {
		// A blob upload with no text body → offer a download.
		if (hasUploadBlob(doc)) return <DownloadFallback doc={doc} />;
		return (
			<div className="text-muted-foreground border-border-subtle border px-4 py-8 text-center text-sm">
				No body content.
			</div>
		);
	}

	if (kind === "html") {
		return (
			<div className="space-y-3">
				<div className="border-border-subtle bg-background overflow-hidden border">
					<iframe
						title={doc.title ?? doc.path ?? "Knowledge preview"}
						sandbox=""
						srcDoc={body}
						className="h-[28rem] w-full bg-white"
					/>
				</div>
				<details className="border-border-subtle bg-muted/30 border p-3">
					<summary className="cursor-pointer text-xs font-medium">
						Source
					</summary>
					<pre className="mt-3 max-h-[24rem] overflow-auto text-xs leading-relaxed whitespace-pre-wrap">
						{body}
					</pre>
				</details>
			</div>
		);
	}

	if (kind === "markdown") return <MarkdownPreview body={body} />;

	return (
		<pre className="bg-muted/40 border-border-subtle max-h-[42rem] overflow-auto border p-4 text-xs leading-relaxed whitespace-pre-wrap">
			{body}
		</pre>
	);
}

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	if (!children) return null;
	return (
		<div className="min-w-0">
			<div className="text-muted-foreground text-[11px] font-medium uppercase">
				{label}
			</div>
			<div className="mt-1 min-w-0 text-sm">{children}</div>
		</div>
	);
}

function RelationLink({
	basePath,
	collection,
	value,
	fallback,
}: {
	basePath: string;
	collection: string;
	value: RelationValue;
	fallback: string;
}) {
	const id = relationId(value);
	if (!id) return <span className="text-muted-foreground">-</span>;
	return (
		<AdminLink
			href={`${basePath}/collections/${collection}/${id}`}
			className="hover:text-foreground text-muted-foreground truncate text-sm underline-offset-4 hover:underline"
		>
			{relationLabel(value, fallback)}
		</AdminLink>
	);
}

function KnowledgeChatContextAction({ doc }: { doc: KnowledgeDoc }) {
	const [attached, setAttached] = React.useState(false);
	const attachment = React.useMemo(
		() => createKnowledgeChatAttachment(doc),
		[doc],
	);

	const attach = React.useCallback(() => {
		dispatchChatAttachment(attachment);
		setAttached(true);
		window.setTimeout(() => setAttached(false), 1200);
	}, [attachment]);

	return (
		<button
			type="button"
			onClick={attach}
			draggable
			onDragStart={(event) =>
				setChatAttachmentDragData(event.dataTransfer, attachment)
			}
			className="control-surface text-muted-foreground hover:text-foreground inline-flex h-8 shrink-0 items-center gap-2 px-2.5 text-xs transition-colors"
			title="Attach this knowledge record to Autopilot chat"
		>
			<Icon
				icon={attached ? "ph:check" : "ph:crosshair"}
				className="size-3.5"
			/>
			<span>{attached ? "Attached" : "Attach"}</span>
		</button>
	);
}

function KnowledgeSummary({
	doc,
	basePath,
}: {
	doc: KnowledgeDoc;
	basePath: string;
}) {
	const summary = knowledgeSummary(doc);
	const sourceLine = knowledgeSourceLine(doc);
	const projectId = relationId(doc.project ?? null);
	const taskId = relationId(doc.task ?? null);
	const runId = relationId(doc.run ?? null);

	return (
		<section className="border-border-subtle bg-card border p-4">
			<div className="flex min-w-0 items-start gap-3">
				<div className="bg-primary/10 text-primary mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md">
					<Icon icon="ph:book-open-text" className="size-4" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
						{sourceLine ? (
							<span className="text-muted-foreground">{sourceLine}</span>
						) : (
							<span className="text-muted-foreground">knowledge</span>
						)}
						{doc.path ? (
							<>
								<span className="text-muted-foreground/50">/</span>
								<span className="text-muted-foreground min-w-0 truncate">
									{doc.path}
								</span>
							</>
						) : null}
					</div>
					{summary ? (
						<p className="text-foreground mt-2 max-w-4xl text-sm leading-relaxed">
							{summary}
						</p>
					) : (
						<p className="text-muted-foreground mt-2 text-sm">
							No summary available.
						</p>
					)}
					{projectId || taskId || runId ? (
						<div className="mt-3 flex flex-wrap gap-2">
							{projectId ? (
								<RelationLink
									basePath={basePath}
									collection="projects"
									value={doc.project ?? null}
									fallback="Project"
								/>
							) : null}
							{taskId ? (
								<RelationLink
									basePath={basePath}
									collection="tasks"
									value={doc.task ?? null}
									fallback="Task"
								/>
							) : null}
							{runId ? (
								<RelationLink
									basePath={basePath}
									collection="run_links"
									value={doc.run ?? null}
									fallback="Run"
								/>
							) : null}
						</div>
					) : null}
				</div>
				<KnowledgeChatContextAction doc={doc} />
			</div>
		</section>
	);
}

function KnowledgeInspector({
	doc,
	basePath,
}: {
	doc: KnowledgeDoc;
	basePath: string;
}) {
	const created = formatDate(doc.createdAt);
	const updated = formatDate(doc.updatedAt);
	const entries = knowledgeMetadataEntries(doc.metadata);

	return (
		<div className="space-y-4">
			<KnowledgeSummary doc={doc} basePath={basePath} />

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
				<section className="border-border-subtle bg-card min-w-0 border p-4">
					<div className="mb-4 flex min-w-0 items-center gap-2">
						<Icon
							icon="ph:file-text"
							className="text-muted-foreground size-4"
						/>
						<h2 className="truncate text-sm font-semibold">Content</h2>
					</div>
					<BodyPreview doc={doc} />
				</section>

				<aside className="space-y-4">
					<section className="border-border-subtle bg-card border p-4">
						<h2 className="mb-3 text-sm font-semibold">Provenance</h2>
						<div className="space-y-3">
							<Field label="Scope">
								<span>{doc.scopeType ?? "-"}</span>
							</Field>
							<Field label="Source">
								<span>{doc.source ?? "-"}</span>
							</Field>
							<Field label="Project">
								<RelationLink
									basePath={basePath}
									collection="projects"
									value={doc.project ?? null}
									fallback="Project"
								/>
							</Field>
							<Field label="Task">
								<RelationLink
									basePath={basePath}
									collection="tasks"
									value={doc.task ?? null}
									fallback="Task"
								/>
							</Field>
							<Field label="Run">
								<RelationLink
									basePath={basePath}
									collection="run_links"
									value={doc.run ?? null}
									fallback="Run"
								/>
							</Field>
							<Field label="Source ref">
								<span className="break-all">{doc.sourceRef ?? "-"}</span>
							</Field>
						</div>
					</section>

					<section className="border-border-subtle bg-card border p-4">
						<h2 className="mb-3 text-sm font-semibold">Metadata</h2>
						<div className="space-y-3">
							<Field label="Created">
								<span>{created ?? "-"}</span>
							</Field>
							<Field label="Updated">
								<span>{updated ?? "-"}</span>
							</Field>
							{entries.length === 0 ? (
								<p className="text-muted-foreground text-sm">
									No useful metadata.
								</p>
							) : (
								<div className="space-y-2">
									{entries.map(([key, value]) => (
										<div key={key} className="min-w-0">
											<div className="text-muted-foreground text-[11px] font-medium uppercase">
												{key}
											</div>
											<pre className="mt-1 overflow-auto text-xs whitespace-pre-wrap">
												{metadataValue(value)}
											</pre>
										</div>
									))}
								</div>
							)}
						</div>
					</section>
				</aside>
			</div>
		</div>
	);
}

function CollectionForm(props: CollectionFormViewProps) {
	return (
		<React.Suspense
			fallback={
				<div className="text-muted-foreground flex items-center justify-center p-12">
					<Icon icon="ph:spinner" className="size-5 animate-spin opacity-40" />
				</div>
			}
		>
			<CollectionFormView {...props} />
		</React.Suspense>
	);
}

export default function KnowledgeDetailComponent(
	props: CollectionFormViewProps,
) {
	const { collection, id, basePath = "/admin" } = props;
	const [mode, setMode] = React.useState<"preview" | "edit">("preview");
	const { data, isLoading, error } = useCollectionItem(
		collection as any,
		id ?? "",
		{ with: { project: true, task: true, run: true }, localeFallback: false },
		{ enabled: !!id },
	);
	const doc = data as KnowledgeDoc | undefined;

	if (!id) return <CollectionForm {...props} />;

	const title = doc?.title ?? doc?.path ?? props.title ?? "Knowledge";
	const path = doc?.path ?? "";

	return (
		<AdminViewLayout
			contentClassName="overflow-y-auto"
			header={
				<AdminViewHeader
					title={title}
					titleAccessory={
						doc?.kind ? (
							<span className="border-border text-muted-foreground inline-flex h-5 items-center border px-2 text-[0.625rem] font-medium">
								{doc.kind}
							</span>
						) : null
					}
					meta={
						<>
							{path ? <span className="truncate">{path}</span> : null}
							{doc?.source ? <span>{doc.source}</span> : null}
							{doc?.contentType ? <span>{doc.contentType}</span> : null}
						</>
					}
					actions={
						<div className="border-border-subtle bg-muted/50 flex overflow-hidden border">
							<button
								type="button"
								onClick={() => setMode("preview")}
								className={[
									"flex h-8 items-center gap-1.5 px-3 text-xs font-medium",
									mode === "preview"
										? "bg-background text-foreground"
										: "text-muted-foreground hover:text-foreground",
								].join(" ")}
							>
								<Icon icon="ph:eye" className="size-3.5" />
								Preview
							</button>
							<button
								type="button"
								onClick={() => setMode("edit")}
								className={[
									"border-border-subtle flex h-8 items-center gap-1.5 border-l px-3 text-xs font-medium",
									mode === "edit"
										? "bg-background text-foreground"
										: "text-muted-foreground hover:text-foreground",
								].join(" ")}
							>
								<Icon icon="ph:pencil-simple" className="size-3.5" />
								Edit
							</button>
						</div>
					}
				/>
			}
		>
			{mode === "edit" ? (
				<CollectionForm {...props} />
			) : (
				<div className="p-4">
					{isLoading ? (
						<div className="text-muted-foreground flex items-center justify-center p-12">
							<Icon
								icon="ph:spinner"
								className="size-5 animate-spin opacity-40"
							/>
						</div>
					) : error ? (
						<div className="border-destructive/30 bg-destructive/10 text-destructive border p-4 text-sm">
							{error instanceof Error
								? error.message
								: "Failed to load knowledge"}
						</div>
					) : doc ? (
						<KnowledgeInspector doc={doc} basePath={basePath} />
					) : (
						<div className="text-muted-foreground border-border-subtle border p-8 text-center text-sm">
							Knowledge resource not found.
						</div>
					)}
				</div>
			)}
		</AdminViewLayout>
	);
}
