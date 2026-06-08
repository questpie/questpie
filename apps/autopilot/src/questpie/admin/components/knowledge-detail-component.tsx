"use client";

import { Icon } from "@iconify/react";
import * as React from "react";

import {
	AdminLink,
	AdminViewHeader,
	AdminViewLayout,
	Button,
	getFileIcon,
	selectAdmin,
	useAdminStore,
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
	hasUploadBlob,
	type KnowledgeDoc,
	type RelationValue,
} from "../lib/knowledge-doc";
import {
	createKnowledgeChatAttachment,
	knowledgeMetadataEntries,
} from "../lib/knowledge-attachments";

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

/** Capitalize the first letter of a renderer name → `pdf` → `Pdf`. */
function cap(value: string): string {
	return value ? value[0].toUpperCase() + value.slice(1) : value;
}

/**
 * Resolve the `file-render-<x>` renderer key for a row. Dispatch matches the
 * legacy two-level logic exactly (so the refactor is behavior-identical):
 *
 *   - a mini-app row (`kind`/`renderer` says so) → the KnowledgeHost host render;
 *   - a TEXT-resource row (no blob `key`) → the editable framework `document`
 *     view, REGARDLESS of its format tag (`renderer:"markdown"/"json"/…`) — a
 *     text resource was always editable, never dispatched by the format string;
 *   - a BLOB row → a type-appropriate VIEWER, selected by its declarative
 *     `renderer` when present (so a drop-in viewer like a future `csv` needs only
 *     a `file-render-csv.tsx` + rows with `renderer:"csv"`), else inferred from
 *     content-type/extension. The content inspection below is the ONLY remaining
 *     sniff, scoped to legacy blob rows that carry no `renderer`.
 *
 * The returned name is `cap()`-ed and looked up in the discovered `components`
 * registry (`getComponents()["fileRender<X>"]`), defaulting to `fileRenderBlob`.
 */
function resolveRendererKey(doc: KnowledgeDoc): string {
	if (doc.kind === "miniapp" || doc.renderer === "miniapp") return "miniapp";
	if (!hasUploadBlob(doc)) return "document";
	return doc.renderer ?? inferRenderer(doc);
}

/**
 * Infer a blob row's VIEWER renderer from its content-type/extension — the lone
 * content sniff, reached only when a blob row carries no declarative `renderer`.
 */
function inferRenderer(doc: KnowledgeDoc): string {
	const contentType = doc.contentType?.toLowerCase() ?? "";
	const path = doc.path ?? "";
	if (contentType.includes("pdf") || /\.pdf$/i.test(path)) return "pdf";
	if (
		/officedocument|msword|ms-excel|ms-powerpoint/.test(contentType) ||
		/\.(docx?|xlsx?|pptx?)$/i.test(path)
	) {
		return "office";
	}
	if (contentType.includes("html") || /\.html?$/i.test(path)) return "html";
	if (contentType.includes("markdown") || /\.mdx?$/i.test(path)) return "markdown";
	return "blob";
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
	children,
}: {
	doc: KnowledgeDoc;
	basePath: string;
	children: React.ReactNode;
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
			<div className="min-w-0">{children}</div>
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

export default function KnowledgeDetailComponent(
	props: CollectionFormViewProps,
) {
	const { collection, id, basePath = "/admin" } = props;
	const admin = useAdminStore(selectAdmin);
	const { data, isLoading, error } = useCollectionItem(
		collection as any,
		id ?? "",
		{ with: { project: true, task: true, run: true }, localeFallback: false },
		{ enabled: !!id },
	);
	const doc = data as KnowledgeDoc | undefined;

	if (!id) return <CollectionForm {...props} />;

	// Resolve the body renderer purely from the DISCOVERED `components` registry,
	// keyed by the row's renderer (+ a localized content-type fallback). Adding a
	// file type is a new `file-render-<x>.tsx` + rows with `renderer:"x"` — zero
	// edits here. Defaults to the download fallback for an unknown renderer.
	const components = (admin?.getComponents() ?? {}) as Record<
		string,
		MaybeLazyComponent
	>;
	const rendererKey = doc ? resolveRendererKey(doc) : null;
	const Renderer = (rendererKey
		? (components[`fileRender${cap(rendererKey)}`] ?? components.fileRenderBlob)
		: components.fileRenderBlob) as React.ComponentType<{
		doc: KnowledgeDoc;
	}>;

	// A text/markdown row resolves to the framework `document` view (own page
	// shell: title + property rows + rich-text body, autosaving). Hand it the
	// form-view props directly — the primitive is a drop-in — and skip the
	// autopilot viewer chrome (the document renderer brings its own).
	if (doc && rendererKey === "document") {
		const DocumentRenderer = Renderer as React.ComponentType<
			{ doc: KnowledgeDoc } & CollectionFormViewProps
		>;
		return <DocumentRenderer doc={doc} {...props} />;
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
								icon={getFileIcon(doc?.contentType ?? undefined)}
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
					actions={doc ? <KnowledgeChatContextAction doc={doc} /> : null}
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
					<KnowledgeInspector doc={doc} basePath={basePath}>
						<Renderer doc={doc} />
					</KnowledgeInspector>
				) : (
					<div className="text-foreground-muted border-border-subtle rounded-[var(--surface-radius)] border p-8 text-center text-sm">
						Knowledge resource not found.
					</div>
				)}
			</div>
		</AdminViewLayout>
	);
}
