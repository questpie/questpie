"use client";

import { Icon } from "@iconify/react";
import * as React from "react";

import {
	AdminLink,
	AdminViewHeader,
	AdminViewLayout,
	Button,
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

/**
 * The framework `document` view primitive (Notion-style, immediately editable,
 * autosaving). Lazy-loaded the SAME way as `CollectionFormView` above — both are
 * registered admin views keyed by name in `adminClientModule.views`. A text/
 * markdown knowledge row mounts this directly so editing reuses the primitive
 * (no bespoke editor, no edit/preview mode).
 */
const DocumentView = React.lazy(async () => {
	const loader = adminClientModule.views["collection-document"].component;
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

/**
 * Declarative `document` config for a text/markdown knowledge row: the `body`
 * field is the dominant rich-text column; a CURATED set of meaningful knowledge
 * fields show as inline-editable property rows; edits autosave. Property names
 * absent from the resolved field map are silently dropped by the primitive.
 *
 * Only fields that carry signal are listed — scope, source provenance, and the
 * timestamps. The redundant/implied fields (`path`, `kind`, `contentType`,
 * `renderer`) and the usually-empty refs (`sourceRef`, `project`, `task`, `run`,
 * `metadata`) are intentionally omitted so the page reads like a clean document,
 * not a raw record dump.
 */
const KNOWLEDGE_DOCUMENT_CONFIG = {
	document: {
		body: "body",
		title: "title",
		save: "autosave",
		properties: ["scopeType", "source", "createdAt", "updatedAt"],
	},
} as const;

/**
 * Human page title for a knowledge doc. Prefer an explicit `title`; otherwise
 * the file's display name (last path segment, e.g. `text-doc-test.md`) so the
 * document page never shows a raw record id. Falls back to the full path.
 */
function documentTitle(doc: KnowledgeDoc): string | undefined {
	if (doc.title && doc.title.trim()) return doc.title.trim();
	const path = doc.path?.trim();
	if (!path) return undefined;
	const segment = path.split("/").filter(Boolean).pop();
	return segment || path;
}

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

/**
 * An EDITABLE text/markdown row: a `body`-backed knowledge doc that is neither a
 * mini-app nor a blob upload. These render with the framework document-view
 * primitive (directly editable). Mini-app + blob rows (pdf/office/image) are
 * type-appropriate VIEWER/host renders, not an editable document.
 */
function isEditableTextRow(doc: KnowledgeDoc) {
	return !isMiniApp(doc) && !hasUploadBlob(doc);
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

/**
 * Neutral file glyph for the document. Mirrors the canonical `getFileIcon`
 * (asset-preview / asset-thumbnail): always a neutral Phosphor file icon, never
 * a colored/brand mark. Drives off the resolved body kind + content type since a
 * knowledge row carries `renderer`/`contentType` rather than a bare MIME string.
 */
function getFileIcon(doc: KnowledgeDoc): string {
	const kind = bodyKind(doc);
	if (kind === "miniapp") return "ph:app-window";
	if (kind === "pdf") return "ph:file-pdf";
	if (kind === "office") return "ph:file-doc";
	if (kind === "html") return "ph:file-html";
	if (kind === "markdown") return "ph:file-text";
	const contentType = doc.contentType?.toLowerCase() ?? "";
	if (contentType.startsWith("image/")) return "ph:file-image";
	if (contentType.startsWith("video/")) return "ph:file-video";
	if (contentType.startsWith("audio/")) return "ph:file-audio";
	if (/json|javascript|typescript|xml/.test(contentType)) return "ph:file-code";
	return "ph:file";
}

function MarkdownPreview({ body }: { body: string }) {
	const blocks = body.split(/(```[\s\S]*?```)/g);
	return (
		<div className="space-y-4">
			{blocks.map((block, index) => {
				const fence = block.match(/^```([\w-]*)\n?([\s\S]*?)```$/);
				if (fence) {
					return (
						<pre
							key={index}
							className="bg-card border-border-subtle max-h-[38rem] overflow-auto rounded-[var(--surface-radius)] border p-4 font-mono text-xs leading-relaxed tabular-nums"
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
		// Real type scale: H1/H2 read as subsection headings (18-20px), H3/H4
		// step down toward body. Headings balance their wrap (DESIGN §Typography).
		if (level === 1) {
			return (
				<h2 className="text-foreground mt-8 text-xl font-semibold tracking-tight text-balance first:mt-0">
					{heading[2]}
				</h2>
			);
		}
		if (level === 2) {
			return (
				<h3 className="text-foreground mt-7 text-lg font-semibold tracking-tight text-balance first:mt-0">
					{heading[2]}
				</h3>
			);
		}
		if (level === 3) {
			return (
				<h4 className="text-foreground mt-6 text-base font-semibold text-balance first:mt-0">
					{heading[2]}
				</h4>
			);
		}
		return (
			<h5 className="text-foreground mt-5 text-sm font-semibold text-balance first:mt-0">
				{heading[2]}
			</h5>
		);
	}

	const lines = trimmed.split("\n");
	if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
		return (
			<ul className="text-foreground marker:text-foreground-subtle list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
				{lines.map((line, index) => (
					<li key={index} className="text-pretty">
						{line.replace(/^\s*[-*]\s+/, "")}
					</li>
				))}
			</ul>
		);
	}

	if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
		return (
			<ol className="text-foreground marker:text-foreground-subtle list-decimal space-y-1.5 pl-5 text-sm leading-relaxed tabular-nums">
				{lines.map((line, index) => (
					<li key={index} className="text-pretty">
						{line.replace(/^\s*\d+\.\s+/, "")}
					</li>
				))}
			</ol>
		);
	}

	return (
		<p className="text-foreground text-sm leading-relaxed text-pretty whitespace-pre-wrap">
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
		<div className="border-border-subtle bg-card flex flex-col items-center justify-center gap-3 rounded-[var(--surface-radius)] border px-4 py-12 text-center">
			<Icon
				icon={getFileIcon(doc)}
				className="text-foreground-subtle size-8"
			/>
			<div className="text-sm font-medium">{name}</div>
			{doc.contentType ? (
				<div className="text-foreground-muted font-mono text-xs">
					{doc.contentType}
				</div>
			) : null}
			{url ? (
				<Button
					variant="outline"
					size="sm"
					nativeButton={false}
					render={<a href={url} download={doc.filename ?? undefined} />}
				>
					<Icon icon="ph:download-simple" data-icon="inline-start" />
					Download
				</Button>
			) : (
				<div className="text-foreground-muted text-xs">
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
				<div className="text-foreground-muted border-border-subtle rounded-[var(--surface-radius)] border px-4 py-8 text-center text-sm">
					This mini-app row is not inside a `.app` bundle path.
				</div>
			);
		}
		return (
			<div className="border-border-subtle bg-background overflow-hidden rounded-[var(--surface-radius)] border">
				<KnowledgeHost appId={appId} className="h-[36rem] w-full" />
			</div>
		);
	}

	// PDF: browsers render application/pdf natively in an <iframe>.
	if (kind === "pdf") {
		const url = resolveBlobUrl(doc);
		if (!url) return <DownloadFallback doc={doc} />;
		return (
			<div className="border-border-subtle bg-background overflow-hidden rounded-[var(--surface-radius)] border">
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
				<div className="space-y-3">
					<div className="border-border-subtle bg-background overflow-hidden rounded-[var(--surface-radius)] border">
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
			<div className="text-foreground-muted border-border-subtle rounded-[var(--surface-radius)] border px-4 py-8 text-center text-sm">
				No body content.
			</div>
		);
	}

	if (kind === "html") {
		return (
			<div className="space-y-3">
				<div className="border-border-subtle bg-background overflow-hidden rounded-[var(--surface-radius)] border">
					<iframe
						title={doc.title ?? doc.path ?? "Knowledge preview"}
						sandbox=""
						srcDoc={body}
						className="h-[28rem] w-full bg-white"
					/>
				</div>
				<details className="border-border-subtle bg-card rounded-[var(--surface-radius)] border p-3">
					<summary className="text-foreground-muted hover:text-foreground cursor-pointer text-xs font-medium">
						Source
					</summary>
					<pre className="mt-3 max-h-[24rem] overflow-auto font-mono text-xs leading-relaxed tabular-nums whitespace-pre-wrap">
						{body}
					</pre>
				</details>
			</div>
		);
	}

	if (kind === "markdown") return <MarkdownPreview body={body} />;

	return (
		<pre className="bg-card border-border-subtle max-h-[42rem] overflow-auto rounded-[var(--surface-radius)] border p-4 font-mono text-xs leading-relaxed tabular-nums whitespace-pre-wrap">
			{body}
		</pre>
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
		<Button
			variant="ghost"
			size="sm"
			onClick={attach}
			draggable
			onDragStart={(event) =>
				setChatAttachmentDragData(event.dataTransfer, attachment)
			}
			className="shrink-0"
			title="Attach this knowledge record to Autopilot chat"
		>
			<Icon
				icon={attached ? "ph:check" : "ph:crosshair"}
				data-icon="inline-start"
			/>
			<span>{attached ? "Attached" : "Attach"}</span>
		</Button>
	);
}

function PropertyRow({
	icon,
	label,
	children,
}: {
	icon: string;
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="hover:bg-surface-mid flex items-start gap-3 rounded-[var(--control-radius-inner)] px-2 py-1.5 transition-colors duration-150">
			<div className="text-foreground-muted flex w-28 shrink-0 items-center gap-2 pt-0.5">
				<Icon
					icon={icon}
					className="text-foreground-subtle size-3.5 shrink-0"
				/>
				<span className="truncate text-xs">{label}</span>
			</div>
			<div className="text-foreground min-w-0 flex-1 text-sm">{children}</div>
		</div>
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
	const projectId = relationId(doc.project ?? null);
	const taskId = relationId(doc.task ?? null);
	const runId = relationId(doc.run ?? null);

	return (
		<div className="mx-auto max-w-3xl px-6 py-8">
			{/* Page properties — Notion-style key/value rows */}
			<div className="mb-7 space-y-px">
				{doc.scopeType ? (
					<PropertyRow icon="ph:stack-simple" label="Scope">
						<span className="capitalize">{doc.scopeType}</span>
					</PropertyRow>
				) : null}
				{doc.source ? (
					<PropertyRow icon="ph:plug" label="Source">
						<span>{doc.source}</span>
					</PropertyRow>
				) : null}
				{projectId ? (
					<PropertyRow icon="ph:folder" label="Project">
						<RelationLink
							basePath={basePath}
							collection="projects"
							value={doc.project ?? null}
							fallback="Project"
						/>
					</PropertyRow>
				) : null}
				{taskId ? (
					<PropertyRow icon="ph:check-square" label="Task">
						<RelationLink
							basePath={basePath}
							collection="tasks"
							value={doc.task ?? null}
							fallback="Task"
						/>
					</PropertyRow>
				) : null}
				{runId ? (
					<PropertyRow icon="ph:play-circle" label="Run">
						<RelationLink
							basePath={basePath}
							collection="run_links"
							value={doc.run ?? null}
							fallback="Run"
						/>
					</PropertyRow>
				) : null}
				{doc.sourceRef ? (
					<PropertyRow icon="ph:hash" label="Source ref">
						<span className="font-mono text-xs break-all">{doc.sourceRef}</span>
					</PropertyRow>
				) : null}
				{created ? (
					<PropertyRow icon="ph:calendar-blank" label="Created">
						<span className="text-foreground-muted tabular-nums">{created}</span>
					</PropertyRow>
				) : null}
				{updated ? (
					<PropertyRow icon="ph:clock-counter-clockwise" label="Updated">
						<span className="text-foreground-muted tabular-nums">{updated}</span>
					</PropertyRow>
				) : null}
				{entries.map(([key, value]) => (
					<PropertyRow key={key} icon="ph:tag" label={key}>
						<pre className="font-mono text-xs break-words tabular-nums whitespace-pre-wrap">
							{metadataValue(value)}
						</pre>
					</PropertyRow>
				))}
			</div>

			<div className="border-border-subtle mb-8 border-t" />

			{/* Document body — content front and center */}
			<div className="min-w-0">
				<BodyPreview doc={doc} />
			</div>
		</div>
	);
}

function CollectionForm(props: CollectionFormViewProps) {
	return (
		<React.Suspense
			fallback={
				<div className="text-foreground-muted flex items-center justify-center p-12">
					<Icon icon="ph:spinner" className="size-5 animate-spin" />
				</div>
			}
		>
			<CollectionFormView {...props} />
		</React.Suspense>
	);
}

/**
 * Mount the framework `document` view primitive for a text/markdown knowledge
 * row. Reuses the form-view props (the primitive is a drop-in with the same
 * `CollectionFormViewProps`); the `viewConfig.document` declares which field is
 * the body, which are property rows, and that edits autosave. The primitive
 * brings its OWN page shell (centered layout + title + autosave indicator), so
 * it is returned directly — not wrapped in the autopilot viewer chrome.
 */
function DocumentDetail({ title, ...props }: CollectionFormViewProps) {
	return (
		<React.Suspense
			fallback={
				<div className="text-foreground-muted flex items-center justify-center p-12">
					<Icon icon="ph:spinner" className="size-5 animate-spin" />
				</div>
			}
		>
			<DocumentView
				{...props}
				viewConfig={KNOWLEDGE_DOCUMENT_CONFIG}
				title={title}
			/>
		</React.Suspense>
	);
}

export default function KnowledgeDetailComponent(
	props: CollectionFormViewProps,
) {
	const { collection, id, basePath = "/admin" } = props;
	const { data, isLoading, error } = useCollectionItem(
		collection as any,
		id ?? "",
		{ with: { project: true, task: true, run: true }, localeFallback: false },
		{ enabled: !!id },
	);
	const doc = data as KnowledgeDoc | undefined;

	if (!id) return <CollectionForm {...props} />;

	// A text/markdown row (no blob `key`, not a mini-app) is an editable
	// document: hand it straight to the framework document-view primitive, which
	// renders the Notion-style page (title + property rows + rich-text body) and
	// autosaves — no edit/preview mode. The primitive owns its own page shell.
	if (doc && isEditableTextRow(doc)) {
		return <DocumentDetail {...props} title={documentTitle(doc)} />;
	}

	// Blob (pdf/office/image) + mini-app rows are type-appropriate VIEWER/host
	// renders, not an editable document. Keep the autopilot inspector chrome.
	const title = doc?.title ?? doc?.path ?? props.title ?? "Knowledge";
	const path = doc?.path ?? "";

	return (
		<AdminViewLayout
			contentClassName="overflow-y-auto"
			header={
				<AdminViewHeader
					title={
						<span className="flex min-w-0 items-center gap-2">
							<Icon
								icon={doc ? getFileIcon(doc) : "ph:file"}
								className="text-foreground-subtle size-5 shrink-0"
							/>
							<span className="min-w-0 truncate">{title}</span>
						</span>
					}
					titleAccessory={
						doc?.kind ? (
							<span className="border-border-subtle bg-surface-mid text-foreground-muted inline-flex h-5 items-center rounded-[var(--control-radius-inner)] border px-2 text-[0.6875rem] font-medium">
								{doc.kind}
							</span>
						) : null
					}
					meta={
						<>
							{path ? (
								<span className="truncate font-mono">{path}</span>
							) : null}
							{doc?.source ? <span>{doc.source}</span> : null}
							{doc?.contentType ? (
								<span className="font-mono">{doc.contentType}</span>
							) : null}
						</>
					}
					actions={
						doc ? <KnowledgeChatContextAction doc={doc} /> : null
					}
				/>
			}
		>
			<div className="p-4">
				{isLoading ? (
					<div className="text-foreground-muted flex items-center justify-center p-12">
						<Icon icon="ph:spinner" className="size-5 animate-spin" />
					</div>
				) : error ? (
					<div className="border-destructive bg-card text-destructive rounded-[var(--surface-radius)] border p-4 text-sm">
						{error instanceof Error
							? error.message
							: "Failed to load knowledge"}
					</div>
				) : doc ? (
					<KnowledgeInspector doc={doc} basePath={basePath} />
				) : (
					<div className="text-foreground-muted border-border-subtle rounded-[var(--surface-radius)] border p-8 text-center text-sm">
						Knowledge resource not found.
					</div>
				)}
			</div>
		</AdminViewLayout>
	);
}
