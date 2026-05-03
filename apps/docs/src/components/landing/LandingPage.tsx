import { Icon } from "@iconify/react";
import { Link } from "@tanstack/react-router";
import {
	type HTMLAttributes,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

/* ─── Helpers ─── */

function CodePanel({
	label,
	children,
	className,
	contentClassName,
	...props
}: {
	label?: ReactNode;
	children: ReactNode;
	className?: string;
	contentClassName?: string;
} & HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			{...props}
			className={cn(
				"border-border-subtle bg-card relative flex h-full min-w-0 flex-col overflow-hidden rounded-[var(--surface-radius)] border shadow-[var(--surface-shadow)]",
				className,
			)}
		>
			{label && (
				<div className="border-border-subtle bg-surface-low text-muted-foreground shrink-0 border-b px-3 py-2 font-mono text-[11px] font-medium">
					{label}
				</div>
			)}
			<div
				className={cn(
					"text-muted-foreground min-h-0 flex-1 overflow-x-auto p-4 font-mono text-[13px] leading-[1.6] whitespace-pre",
					contentClassName,
				)}
			>
				{children}
			</div>
		</div>
	);
}

function Badge({ children }: { children: ReactNode }) {
	return (
		<span className="border-border-subtle bg-surface-low text-muted-foreground font-chrome inline-flex items-center rounded-[var(--control-radius-inner)] border px-2.5 py-1 text-[11px] font-medium">
			{children}
		</span>
	);
}

function SectionHeader({
	num,
	title,
	subtitle,
}: {
	num: string;
	title: string;
	subtitle: string;
}) {
	return (
		<div className="mb-8 md:mb-12">
			<div className="text-muted-foreground mb-3 font-mono text-xs font-medium">
				{num}
			</div>
			<h2 className="text-foreground mb-4 text-3xl leading-tight font-semibold text-balance md:text-4xl">
				{title}
			</h2>
			<p className="text-muted-foreground max-w-2xl text-lg leading-[1.65] text-pretty">
				{subtitle}
			</p>
		</div>
	);
}

function Reveal({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			data-reveal
			className={cn(
				"translate-y-3 opacity-0 transition-[opacity,transform] duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] data-[visible]:translate-y-0 data-[visible]:opacity-100 motion-reduce:translate-y-0 motion-reduce:transition-none",
				className,
			)}
		>
			{children}
		</div>
	);
}

function VisualAssetFrame({
	asset,
	children,
	className,
	...props
}: {
	asset?: string;
	children: ReactNode;
	className?: string;
} & HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			{...props}
			data-section-asset={asset}
			className={cn(
				"md:border-border-subtle md:bg-card relative min-w-0 overflow-hidden p-0 md:rounded-[var(--surface-radius)] md:border md:p-6 md:shadow-[var(--surface-shadow)]",
				className,
			)}
		>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 hidden bg-[radial-gradient(circle_at_50%_0,color-mix(in_srgb,var(--foreground)_5%,transparent)_0,transparent_28rem)] md:block"
			/>
			<div className="relative">{children}</div>
		</div>
	);
}

function VisualNode({
	icon,
	title,
	description,
	active,
	className,
	children,
}: {
	icon?: string;
	title: string;
	description?: string;
	active?: boolean;
	className?: string;
	children?: ReactNode;
}) {
	return (
		<div
			className={cn(
				"border-border-subtle bg-surface-low min-w-0 rounded-[var(--control-radius)] border p-3",
				active && "border-border-strong bg-surface-high",
				className,
			)}
		>
			<div className="flex min-w-0 items-center gap-2">
				{icon && (
					<Icon
						ssr
						aria-hidden="true"
						icon={icon}
						width={15}
						height={15}
						className="text-muted-foreground shrink-0"
					/>
				)}
				<div className="text-foreground font-chrome min-w-0 truncate text-sm font-semibold">
					{title}
				</div>
			</div>
			{description && (
				<p className="text-muted-foreground mt-1 text-xs leading-relaxed text-pretty">
					{description}
				</p>
			)}
			{children}
		</div>
	);
}

/* ─── Swap Anything Section (interactive config builder) ─── */

type AdapterOption = {
	label: string;
	fn: string;
	code: string;
	soon?: boolean;
};

type AdapterCategory = {
	key: string;
	label: string;
	options: AdapterOption[];
};

const ADAPTER_CATEGORIES: AdapterCategory[] = [
	{
		key: "kv",
		label: "KV / Cache",
		options: [
			{
				label: "Custom Redis",
				fn: "KVAdapter",
				code: "kv: { adapter: myRedisAdapter }",
			},
			{
				label: "Memory",
				fn: "default memory",
				code: "kv: { defaultTtl: 3600 }",
			},
			{
				label: "CF KV",
				fn: "KVAdapter",
				code: "kv: { adapter: myCloudflareKvAdapter }",
				soon: true,
			},
		],
	},
	{
		key: "queue",
		label: "Queue",
		options: [
			{
				label: "pg-boss",
				fn: "pgBossAdapter",
				code: "queue: { adapter: pgBossAdapter({ connectionString }) }",
			},
			{
				label: "CF Queues",
				fn: "cloudflareQueuesAdapter",
				code: "queue: { adapter: cloudflareQueuesAdapter({ enqueue }) }",
			},
			{
				label: "BullMQ",
				fn: "bullmqAdapter",
				code: "queue: { adapter: bullmqAdapter() }",
				soon: true,
			},
		],
	},
	{
		key: "search",
		label: "Search",
		options: [
			{
				label: "Postgres FTS",
				fn: "createPostgresSearchAdapter",
				code: "search: createPostgresSearchAdapter()",
			},
			{
				label: "pgvector",
				fn: "createPgVectorSearchAdapter",
				code: "search: createPgVectorSearchAdapter({ embeddings })",
			},
			{
				label: "Meilisearch",
				fn: "meilisearchAdapter",
				code: "search: meilisearchAdapter()",
				soon: true,
			},
		],
	},
	{
		key: "realtime",
		label: "Realtime",
		options: [
			{
				label: "PG NOTIFY",
				fn: "pgNotifyAdapter",
				code: "realtime: { adapter: pgNotifyAdapter() }",
			},
			{
				label: "Redis Streams",
				fn: "redisStreamsAdapter",
				code: "realtime: { adapter: redisStreamsAdapter({ client }) }",
			},
		],
	},
	{
		key: "storage",
		label: "Storage",
		options: [
			{
				label: "S3",
				fn: "S3Driver",
				code: 'storage: { driver: new S3Driver({ bucket: "assets" }) }',
			},
			{
				label: "R2",
				fn: "S3Driver",
				code: "storage: { driver: new S3Driver({ endpoint: env.R2_URL }) }",
			},
			{
				label: "GCS",
				fn: "FlyDrive driver",
				code: "storage: { driver: myGcsDriver }",
			},
			{
				label: "Local",
				fn: "local FS",
				code: 'storage: { location: "./uploads" }',
			},
		],
	},
	{
		key: "email",
		label: "Email",
		options: [
			{
				label: "SMTP",
				fn: "SmtpAdapter",
				code: "email: { adapter: new SmtpAdapter({ transport }) }",
			},
			{
				label: "Console",
				fn: "ConsoleAdapter",
				code: "email: { adapter: new ConsoleAdapter() }",
			},
			{
				label: "Resend",
				fn: "resendAdapter",
				code: "email: { adapter: resendAdapter() }",
				soon: true,
			},
		],
	},
];

function SwapAnythingSection() {
	const [selections, setSelections] = useState<Record<string, number>>({
		kv: 0,
		queue: 0,
		search: 0,
		realtime: 0,
		storage: 0,
		email: 0,
	});

	const handleSelect = (key: string, index: number) => {
		setSelections((prev) => ({ ...prev, [key]: index }));
	};

	return (
		<>
			<SectionHeader
				num="03"
				title="Keep your stack. Swap the adapter."
				subtitle="Cache, queue, search, realtime, storage, and email stay in app config. QUESTPIE treats infrastructure as replaceable adapters, not a platform lock-in."
			/>

			<div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_1.2fr]">
				{/* Left: adapter grid */}
				<div className="grid min-w-0 auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2">
					{ADAPTER_CATEGORIES.map((cat) => (
						<div
							key={cat.key}
							className="border-border-subtle bg-card flex min-h-32 flex-col rounded-[var(--surface-radius)] border p-4 shadow-[var(--surface-shadow)]"
						>
							<div className="text-muted-foreground mb-2 font-mono text-[11px] font-medium">
								{cat.label}
							</div>
							<div className="flex flex-1 flex-wrap content-start gap-1.5">
								{cat.options.map((opt, i) => (
									<button
										key={opt.label}
										type="button"
										disabled={opt.soon}
										onClick={() => !opt.soon && handleSelect(cat.key, i)}
										aria-pressed={!opt.soon && selections[cat.key] === i}
										className={cn(
											"font-chrome min-h-10 rounded-[var(--control-radius-inner)] border px-2.5 py-1 text-xs font-medium transition-[background-color,color,border-color,transform,opacity] active:scale-[0.96] motion-reduce:active:scale-100",
											opt.soon
												? "border-border-subtle text-muted-foreground/40 cursor-default opacity-70 active:scale-100"
												: selections[cat.key] === i
													? "border-border-strong bg-surface-high text-foreground"
													: "border-border-subtle bg-card text-muted-foreground hover:bg-surface-low hover:text-foreground",
										)}
									>
										{opt.label}
										{opt.soon && (
											<span className="text-muted-foreground/40 ml-1 font-mono text-[9px]">
												soon
											</span>
										)}
									</button>
								))}
							</div>
						</div>
					))}
				</div>

				{/* Right: live config output */}
				<div className="grid min-w-0 content-start gap-3">
					<div className="border-border-subtle bg-card relative min-w-0 overflow-hidden rounded-[var(--surface-radius)] border shadow-[var(--surface-shadow)]">
						<div className="border-border-subtle bg-surface-low text-muted-foreground border-b px-3 py-2 font-mono text-[11px] font-medium">
							questpie.config.ts
						</div>
						<div className="text-muted-foreground overflow-x-auto p-4 font-mono text-[13px] leading-[1.8] whitespace-pre">
							<span className="text-[var(--syntax-function)]">
								runtimeConfig
							</span>
							{"({\n"}
							{ADAPTER_CATEGORIES.map((cat) => {
								const opt = cat.options[selections[cat.key]];
								const fnIdx = opt.code.indexOf(opt.fn);
								const hasHighlight = fnIdx >= 0;
								const before = hasHighlight
									? opt.code.slice(0, fnIdx)
									: opt.code;
								const after = hasHighlight
									? opt.code.slice(fnIdx + opt.fn.length)
									: "";

								return (
									<span key={cat.key}>
										{"  "}
										{before}
										{hasHighlight && (
											<span className="text-[var(--syntax-function)]">
												{opt.fn}
											</span>
										)}
										{after}
										{",\n"}
									</span>
								);
							})}
							{"})"}
						</div>
						<div className="text-muted-foreground border-border-subtle mx-4 border-t px-1 py-3 text-sm leading-relaxed">
							Select an adapter on the left. The config mirrors the selected
							runtime slot.
						</div>
					</div>
					<Link
						to="/docs/$"
						params={{ _splat: "extend/custom-adapters" }}
						className="border-border-subtle bg-card text-muted-foreground hover:bg-surface-low hover:text-foreground flex min-h-28 items-center justify-between gap-4 rounded-[var(--surface-radius)] border p-4 shadow-[var(--surface-shadow)] transition-[background-color,color,transform] active:scale-[0.96] motion-reduce:active:scale-100 lg:min-h-[9rem]"
					>
						<div className="min-w-0">
							<div className="mb-2 font-mono text-[11px] font-medium">
								Custom
							</div>
							<div className="font-chrome flex min-w-0 items-center gap-1.5 text-sm font-medium">
								<Icon
									ssr
									icon="ph:code"
									width={14}
									height={14}
									className="shrink-0"
								/>
								<span className="truncate">Write your own adapter</span>
							</div>
							<p className="mt-1 text-xs leading-relaxed text-pretty">
								Under 50 lines when the runtime slot already exists.
							</p>
						</div>
						<Icon
							icon="ph:arrow-right"
							width={14}
							height={14}
							className="shrink-0"
						/>
					</Link>
				</div>
			</div>
		</>
	);
}

/* ─── File Conventions Section (with toggle + staggered badges) ─── */

const CONVENTION_ASSET_FILES = {
	"by-type": [
		{
			icon: "ph:database",
			title: "collections/posts.ts",
			description: "Model + CRUD",
		},
		{
			icon: "ph:signpost",
			title: "routes/admin/stats.ts",
			description: "Typed HTTP action",
		},
		{
			icon: "ph:lightning",
			title: "jobs/send-newsletter.ts",
			description: "Queue worker",
		},
	],
	"by-feature": [
		{
			icon: "ph:folder-simple",
			title: "blog/collections/posts.ts",
			description: "Feature-owned model",
		},
		{
			icon: "ph:folder-simple",
			title: "shop/services/stripe.ts",
			description: "Feature service",
		},
		{
			icon: "ph:folder-simple",
			title: "shared/routes/stats.ts",
			description: "Shared action",
		},
	],
} as const;

const CONVENTION_ASSET_OUTPUTS = [
	{
		icon: "ph:brackets-curly",
		title: "Registry keys",
		description: "camelized from factory identity",
	},
	{
		icon: "ph:tree-structure",
		title: "Runtime module",
		description: "collections, routes, jobs, services",
	},
	{
		icon: "ph:code",
		title: "Type surface",
		description: "App, AppConfig, client SDK",
	},
] as const;

function FileConventionAsset({ layout }: { layout: "by-type" | "by-feature" }) {
	const files = CONVENTION_ASSET_FILES[layout];

	return (
		<VisualAssetFrame asset="file-conventions">
			<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
				<div>
					<div className="text-muted-foreground font-mono text-[11px] font-medium">
						File convention pipeline
					</div>
					<h3 className="text-foreground mt-1 text-lg leading-tight font-semibold text-balance">
						Folder structure becomes runtime structure
					</h3>
				</div>
				<div className="border-border-subtle bg-surface-low text-muted-foreground rounded-[var(--control-radius-inner)] border px-2.5 py-1 font-mono text-[11px]">
					{layout === "by-type" ? "by type" : "by feature"}
				</div>
			</div>

			<div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
				<div className="grid gap-3">
					{files.map((file) => (
						<VisualNode
							key={file.title}
							icon={file.icon}
							title={file.title}
							description={file.description}
						/>
					))}
				</div>

				<div className="border-border-subtle bg-surface-high mx-auto flex size-28 flex-col items-center justify-center rounded-[var(--surface-radius)] border text-center shadow-[var(--surface-shadow)]">
					<Icon
						ssr
						aria-hidden="true"
						icon="ph:gear-six"
						width={22}
						height={22}
						className="text-muted-foreground mb-2"
					/>
					<div className="text-foreground font-chrome text-sm font-semibold">
						Codegen
					</div>
					<div className="text-muted-foreground mt-1 font-mono text-[10px]">
						discover + emit
					</div>
				</div>

				<div className="grid gap-3">
					{CONVENTION_ASSET_OUTPUTS.map((output) => (
						<VisualNode
							key={output.title}
							icon={output.icon}
							title={output.title}
							description={output.description}
						/>
					))}
				</div>
			</div>
		</VisualAssetFrame>
	);
}

function FileConventionsSection() {
	const [layout, setLayout] = useState<"by-type" | "by-feature">("by-type");

	const byTypeTree = (
		<>
			<span className="text-primary">src/questpie/server/</span>
			{`
collections/`}
			<span className="text-foreground font-bold">posts.ts</span>
			{`
collections/`}
			<span className="text-foreground font-bold">users.ts</span>
			{`
routes/`}
			<span className="text-foreground font-bold">admin/stats.ts</span>
			{`
blocks/`}
			<span className="text-foreground font-bold">hero.ts</span>
			{`
jobs/`}
			<span className="text-foreground font-bold">send-newsletter.ts</span>
			{`
services/`}
			<span className="text-foreground font-bold">stripe.ts</span>
			{`
seeds/`}
			<span className="text-foreground font-bold">demo-data.ts</span>
			{`
`}
			<span className="text-foreground font-bold">auth.ts</span>
		</>
	);

	const byFeatureTree = (
		<>
			<span className="text-primary">src/questpie/server/</span>
			{`
blog/collections/`}
			<span className="text-foreground font-bold">posts.ts</span>
			{`
blog/blocks/`}
			<span className="text-foreground font-bold">hero.ts</span>
			{`
blog/jobs/`}
			<span className="text-foreground font-bold">newsletter.ts</span>
			{`
shop/collections/`}
			<span className="text-foreground font-bold">products.ts</span>
			{`
shop/collections/`}
			<span className="text-foreground font-bold">orders.ts</span>
			{`
shop/services/`}
			<span className="text-foreground font-bold">stripe.ts</span>
			{`
shared/collections/`}
			<span className="text-foreground font-bold">users.ts</span>
			{`
shared/routes/`}
			<span className="text-foreground font-bold">stats.ts</span>
			{`
`}
			<span className="text-foreground font-bold">auth.ts</span>
		</>
	);

	return (
		<>
			<SectionHeader
				num="02"
				title="A file is a feature, not a registration chore"
				subtitle="Collections, routes, jobs, services, blocks, and seeds are discovered from the server directory. Codegen turns file intent into runtime modules and typed client surfaces."
			/>

			<div className="border-border-subtle bg-surface-low mb-4 inline-flex gap-1 rounded-[var(--control-radius)] border p-1">
				{(["by-type", "by-feature"] as const).map((mode) => (
					<button
						key={mode}
						type="button"
						onClick={() => setLayout(mode)}
						aria-pressed={layout === mode}
						className={cn(
							"font-chrome min-h-10 rounded-[var(--control-radius-inner)] px-3 text-xs font-medium transition-[background-color,color,transform] active:scale-[0.96] motion-reduce:active:scale-100",
							layout === mode
								? "bg-surface-high text-foreground"
								: "text-muted-foreground hover:bg-card hover:text-foreground",
						)}
					>
						{mode === "by-type" ? "By type" : "By feature"}
					</button>
				))}
			</div>

			<div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.05fr_0.95fr]">
				<FileConventionAsset layout={layout} />
				<CodePanel
					label={
						layout === "by-type"
							? "server layout — by type"
							: "server layout — by feature"
					}
				>
					{layout === "by-type" ? byTypeTree : byFeatureTree}
				</CodePanel>
			</div>
		</>
	);
}

/* ─── §04 Admin Showcase Section ─── */

const adminScreenshotSrc: string | null = null;

function AdminScreenshotSlot({ children }: { children: ReactNode }) {
	return (
		<div
			data-admin-screenshot-slot
			className="admin-step-content md:border-border-subtle md:bg-card flex min-h-0 flex-1 flex-col overflow-hidden md:min-h-[26rem] md:rounded-[var(--surface-radius)] md:border md:shadow-[var(--surface-shadow)]"
		>
			{adminScreenshotSrc ? (
				<img
					src={adminScreenshotSrc}
					alt="QUESTPIE admin workspace"
					className="h-full min-h-0 w-full object-cover outline outline-1 outline-black/10 md:min-h-[26rem] dark:outline-white/10"
				/>
			) : (
				children
			)}
		</div>
	);
}

function AdminShowcaseSection() {
	const [activeTab, setActiveTab] = useState(0);

	type AdminTab = {
		label: string;
		codeLabel: string;
		code: ReactNode;
		mockup: ReactNode;
	};

	const tabs: AdminTab[] = [
		{
			label: "Collection",
			codeLabel: "collections/posts.ts",
			code: (
				<>
					<span className="text-primary font-semibold">collection</span>(
					<span className="text-[var(--syntax-string)]">"posts"</span>){`\n  .`}
					<span className="text-[var(--syntax-function)]">admin</span>
					{`(({ c }) => ({
    label: `}
					<span className="text-[var(--syntax-string)]">"Posts"</span>
					{`,
    icon: c.icon(`}
					<span className="text-[var(--syntax-string)]">"ph:article"</span>
					{`),
  }))
  .`}
					<span className="text-[var(--syntax-function)]">list</span>
					{`(({ v }) => v.collectionTable({
    columns: [`}
					<span className="text-[var(--syntax-string)]">"title"</span>
					{`, `}
					<span className="text-[var(--syntax-string)]">"status"</span>
					{`, `}
					<span className="text-[var(--syntax-string)]">"author"</span>
					{`, `}
					<span className="text-[var(--syntax-string)]">"date"</span>
					{`],
  }))
  .`}
					<span className="text-[var(--syntax-function)]">form</span>
					{`(({ v, f }) => v.collectionForm({
    fields: [f.title, f.content],
    sidebar: { fields: [f.status, f.author] },
  }))
  .`}
					<span className="text-[var(--syntax-function)]">access</span>
					{`({
    create: ({ session }) => !!session,
    update: ({ session, doc }) =>
      doc.authorId === session?.user?.id,
  })`}
				</>
			),
			mockup: (
				<>
					<div className="border-border-subtle bg-surface-low flex h-11 items-center justify-between border-b px-4">
						<div className="font-chrome text-sm font-semibold">Posts</div>
						<button
							type="button"
							className="border-border-subtle bg-surface-high text-foreground hover:bg-surface-highest font-chrome rounded-[var(--control-radius-inner)] border px-3 py-1.5 text-xs font-medium transition-[background-color,transform] active:scale-[0.96] motion-reduce:active:scale-100"
						>
							Create
						</button>
					</div>
					<div className="flex flex-1">
						<div className="border-border-subtle bg-card hidden w-28 border-r p-3 sm:block">
							<ul className="text-muted-foreground font-chrome flex flex-col gap-2 text-xs">
								<li className="text-foreground bg-surface-high rounded-[var(--control-radius-inner)] px-2 py-1 font-medium">
									Posts
								</li>
								<li>Users</li>
								<li>Settings</li>
							</ul>
						</div>
						<div className="flex-1 overflow-x-auto p-4">
							<table className="w-full border-collapse text-left">
								<thead>
									<tr>
										{["Title", "Status", "Author", "Date"].map((h) => (
											<th
												key={h}
												className="text-muted-foreground border-border-subtle font-chrome border-b pb-2 text-xs font-medium"
											>
												{h}
											</th>
										))}
									</tr>
								</thead>
								<tbody className="text-[13px]">
									{[
										{
											title: "Getting Started Guide",
											status: "published",
											author: "admin",
											date: "Mar 15",
										},
										{
											title: "Adapter Architecture",
											status: "draft",
											author: "admin",
											date: "Mar 12",
										},
									].map((row) => (
										<tr key={row.title}>
											<td className="text-foreground border-border-subtle border-b py-3 pr-4">
												{row.title}
											</td>
											<td className="border-border-subtle border-b py-3 pr-4">
												{row.status === "published" ? (
													<Badge>Published</Badge>
												) : (
													<span className="border-border-subtle bg-surface-low text-muted-foreground font-chrome inline-flex rounded-[var(--control-radius-inner)] border px-2.5 py-1 text-[11px] font-medium">
														Draft
													</span>
												)}
											</td>
											<td className="text-muted-foreground border-border-subtle border-b py-3 pr-4">
												{row.author}
											</td>
											<td className="text-muted-foreground border-border-subtle border-b py-3">
												{row.date}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</>
			),
		},
		{
			label: "Global",
			codeLabel: "globals/site-settings.ts",
			code: (
				<>
					<span className="text-primary font-semibold">global</span>(
					<span className="text-[var(--syntax-string)]">"siteSettings"</span>)
					{`\n  .`}
					<span className="text-[var(--syntax-function)]">fields</span>
					{`(({ f }) => ({
    siteName: f.`}
					<span className="text-[var(--syntax-function)]">text</span>
					{`(),
    tagline:  f.`}
					<span className="text-[var(--syntax-function)]">text</span>
					{`(),
    logo:     f.`}
					<span className="text-[var(--syntax-function)]">upload</span>
					{`(),
  }))
  .`}
					<span className="text-[var(--syntax-function)]">options</span>
					{`({ versioning: `}
					<span className="text-primary font-semibold">true</span>
					{` })`}
				</>
			),
			mockup: (
				<div className="flex flex-1 flex-col">
					<div className="border-border-subtle bg-surface-low flex h-11 items-center justify-between border-b px-4">
						<div className="font-chrome text-sm font-semibold">
							Site Settings
						</div>
						<button
							type="button"
							className="border-border-subtle bg-card text-foreground hover:bg-surface-high font-chrome flex items-center gap-1 rounded-[var(--control-radius-inner)] border px-2.5 py-1 text-xs font-medium transition-[background-color,transform] active:scale-[0.96] motion-reduce:active:scale-100"
						>
							<Icon
								ssr
								icon="ph:clock-counter-clockwise"
								width={12}
								height={12}
							/>
							History
						</button>
					</div>
					<div className="flex flex-1">
						<div className="flex flex-1 flex-col gap-4 p-4">
							{[
								{ label: "Site Name", value: "QuestPie Docs" },
								{
									label: "Tagline",
									value: "Define once. Project everywhere.",
								},
							].map((field) => (
								<div key={field.label}>
									<div className="text-muted-foreground font-chrome mb-1.5 block text-xs font-medium">
										{field.label}
									</div>
									<div className="border-border-subtle bg-card text-foreground font-chrome rounded-[var(--control-radius)] border px-3 py-2 text-sm">
										{field.value}
									</div>
								</div>
							))}
							<div>
								<div className="text-muted-foreground font-chrome mb-1.5 block text-xs font-medium">
									Logo
								</div>
								<div className="border-border-subtle bg-surface-low flex h-16 items-center justify-center rounded-[var(--control-radius)] border">
									<Icon
										ssr
										icon="ph:image"
										width={20}
										height={20}
										className="text-muted-foreground"
									/>
								</div>
							</div>
						</div>
						<div className="border-border-subtle bg-card w-40 border-l p-3">
							<div className="text-muted-foreground font-chrome mb-3 text-xs font-medium">
								Version history
							</div>
							<div className="flex flex-col gap-2">
								{[
									{
										v: "v3 — current",
										time: "2 min ago",
										active: true,
									},
									{
										v: "v2",
										time: "1 hour ago",
										active: false,
									},
									{ v: "v1", time: "Mar 14", active: false },
								].map((ver) => (
									<div
										key={ver.v}
										className={`border-l-2 pl-2 ${ver.active ? "border-border-strong" : "border-border-subtle"}`}
									>
										<div
											className={`font-mono text-[10px] ${ver.active ? "text-foreground font-bold" : "text-muted-foreground"}`}
										>
											{ver.v}
										</div>
										<div className="text-muted-foreground font-mono text-[9px]">
											{ver.time}
										</div>
									</div>
								))}
							</div>
						</div>
					</div>
				</div>
			),
		},
		{
			label: "Admin config",
			codeLabel: "config/admin.ts",
			code: (
				<>
					<span className="text-primary font-semibold">export default</span>{" "}
					<span className="text-[var(--syntax-function)]">adminConfig</span>
					{`({
  sidebar: {
    sections: [
      { id: `}
					<span className="text-[var(--syntax-string)]">"content"</span>
					{`, title: `}
					<span className="text-[var(--syntax-string)]">"Content"</span>
					{` },
    ],
    items: [
      { sectionId: `}
					<span className="text-[var(--syntax-string)]">"content"</span>
					{`, type: `}
					<span className="text-[var(--syntax-string)]">"collection"</span>
					{`,
        collection: `}
					<span className="text-[var(--syntax-string)]">"posts"</span>
					{` },
      { sectionId: `}
					<span className="text-[var(--syntax-string)]">"content"</span>
					{`, type: `}
					<span className="text-[var(--syntax-string)]">"collection"</span>
					{`,
        collection: `}
					<span className="text-[var(--syntax-string)]">"users"</span>
					{` },
    ],
  },
  dashboard: {
    actions: [
      { id: `}
					<span className="text-[var(--syntax-string)]">"new-post"</span>
					{`, href: `}
					<span className="text-[var(--syntax-string)]">
						"/admin/collections/posts?create=true"
					</span>
					{`, label: `}
					<span className="text-[var(--syntax-string)]">"New Post"</span>
					{` },
    ],
  },
  locale: {
    locales: [`}
					<span className="text-[var(--syntax-string)]">"en"</span>
					{`, `}
					<span className="text-[var(--syntax-string)]">"sk"</span>
					{`],
    defaultLocale: `}
					<span className="text-[var(--syntax-string)]">"en"</span>
					{`,
  },
})`}
				</>
			),
			mockup: (
				<div className="flex flex-1 flex-col">
					<div className="border-border-subtle bg-surface-low flex h-11 items-center justify-between border-b px-4">
						<div className="font-chrome text-sm font-semibold">Admin</div>
						<div className="border-border-subtle bg-card flex overflow-hidden rounded-[var(--control-radius-inner)] border">
							<button
								type="button"
								className="bg-surface-high text-foreground font-chrome px-2.5 py-1 text-xs font-medium"
							>
								EN
							</button>
							<button
								type="button"
								className="text-muted-foreground border-border-subtle font-chrome border-l px-2.5 py-1 text-xs font-medium"
							>
								SK
							</button>
						</div>
					</div>
					<div className="flex flex-1">
						<div className="border-border-subtle bg-card w-36 border-r p-3">
							<div className="text-muted-foreground font-chrome mb-2 text-xs font-medium">
								Content
							</div>
							<ul className="font-chrome mb-4 flex flex-col gap-1 text-xs">
								<li className="bg-surface-high text-foreground flex items-center gap-2 rounded-[var(--control-radius-inner)] px-2 py-1.5 font-medium">
									<Icon
										ssr
										icon="ph:article"
										width={14}
										height={14}
										className="text-muted-foreground"
									/>
									Posts
								</li>
								<li className="text-muted-foreground flex items-center gap-2 px-2 py-1.5">
									<Icon ssr icon="ph:users" width={14} height={14} />
									Users
								</li>
							</ul>
							<div className="border-border-subtle border-t pt-3">
								<ul className="font-chrome flex flex-col gap-1 text-xs">
									<li className="text-muted-foreground flex items-center gap-2 px-2 py-1.5">
										<Icon ssr icon="ph:gear" width={14} height={14} />
										Settings
									</li>
								</ul>
							</div>
						</div>
						<div className="flex-1 p-4">
							<div className="font-chrome mb-4 text-xs font-medium">
								Quick actions
							</div>
							<div className="mb-5 flex flex-wrap gap-2">
								<button
									type="button"
									className="border-border-subtle bg-card text-foreground hover:bg-surface-high font-chrome flex items-center gap-1.5 rounded-[var(--control-radius-inner)] border px-3 py-1.5 text-xs font-medium transition-[background-color,transform] active:scale-[0.96] motion-reduce:active:scale-100"
								>
									<Icon ssr icon="ph:plus" width={12} height={12} />
									Create Post
								</button>
							</div>
							<div className="grid grid-cols-2 gap-3">
								{[
									{ label: "Total posts", value: "142" },
									{ label: "Published", value: "89" },
								].map((s) => (
									<div
										key={s.label}
										className="border-border-subtle bg-surface-low rounded-[var(--control-radius)] border p-3"
									>
										<div className="text-muted-foreground font-chrome text-xs font-medium">
											{s.label}
										</div>
										<div className="text-foreground text-xl font-semibold tabular-nums">
											{s.value}
										</div>
									</div>
								))}
							</div>
						</div>
					</div>
				</div>
			),
		},
	];

	const current = tabs[activeTab];
	const projectionPoints = [
		{
			icon: "ph:tree-structure",
			title: "Registry-resolved",
			description:
				"Server emits references. The admin client resolves them through registered views and components.",
		},
		{
			icon: "ph:sliders-horizontal",
			title: "Configured, not forked",
			description:
				"Sidebar, dashboard, forms, actions, and field rendering stay in admin config and builder extensions.",
		},
		{
			icon: "ph:arrows-clockwise",
			title: "Replaceable surface",
			description:
				"Use the default workspace while it fits, then swap views or package your own module without rewriting the backend.",
		},
	];

	return (
		<>
			<SectionHeader
				num="04"
				title="Admin is a projection, not a second product"
				subtitle="The admin UI reads the same collection, global, field, view, and component contracts as the rest of your app. Use the default admin, extend it, or replace it."
			/>

			{/* Tab bar */}
			<div className="border-border-subtle bg-surface-low inline-flex rounded-[var(--control-radius)] border p-1">
				<div className="flex flex-wrap gap-1">
					{tabs.map((tab, i) => (
						<button
							key={tab.label}
							type="button"
							onClick={() => setActiveTab(i)}
							aria-pressed={i === activeTab}
							className={cn(
								"font-chrome min-h-10 rounded-[var(--control-radius-inner)] px-3 py-2 text-xs font-medium transition-[background-color,color,transform] active:scale-[0.96] motion-reduce:active:scale-100",
								i === activeTab
									? "bg-surface-high text-foreground"
									: "text-muted-foreground hover:bg-card hover:text-foreground",
							)}
						>
							{tab.label}
						</button>
					))}
				</div>
			</div>

			{/* Content grid */}
			<div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
				<div className="grid grid-cols-1 gap-3 lg:col-span-5">
					{projectionPoints.map((point) => (
						<div
							key={point.title}
							className="border-border-subtle bg-card rounded-[var(--surface-radius)] border p-5 shadow-[var(--surface-shadow)]"
						>
							<div className="text-muted-foreground mb-3 flex items-center gap-2">
								<Icon ssr icon={point.icon} width={17} height={17} />
								<h3 className="text-foreground font-chrome text-sm font-semibold">
									{point.title}
								</h3>
							</div>
							<p className="text-muted-foreground text-sm leading-relaxed text-pretty">
								{point.description}
							</p>
						</div>
					))}
				</div>

				<div
					className="flex flex-col lg:col-span-7"
					key={`mockup-${activeTab}`}
				>
					<AdminScreenshotSlot>{current.mockup}</AdminScreenshotSlot>
				</div>
			</div>
		</>
	);
}

/* ─── §05 End-to-End Types (clickable pipeline) ─── */

const TYPE_IMPACT_NODES = [
	{
		icon: "ph:pencil-simple-line",
		title: "Field def",
		description: "source contract",
	},
	{
		icon: "ph:brackets-curly",
		title: "Codegen",
		description: "typed registry",
	},
	{
		icon: "ph:database",
		title: "Drizzle",
		description: "storage shape",
	},
	{
		icon: "ph:shield-check",
		title: "Zod",
		description: "runtime guard",
	},
	{
		icon: "ph:terminal-window",
		title: "Client SDK",
		description: "typed query",
	},
] as const;

function TypeImpactAsset({
	activeStep,
	onStepChange,
}: {
	activeStep: number;
	onStepChange: (step: number) => void;
}) {
	return (
		<VisualAssetFrame asset="type-impact" className="md:p-5">
			<div className="mb-4 flex flex-wrap items-start justify-between gap-3">
				<div>
					<div className="text-muted-foreground font-mono text-[11px] font-medium">
						Impact map
					</div>
					<h3 className="text-foreground mt-1 text-lg leading-tight font-semibold text-balance">
						One field edit ripples through every contract
					</h3>
				</div>
				<div className="border-border-subtle bg-surface-low text-muted-foreground rounded-[var(--control-radius-inner)] border px-2.5 py-1 font-mono text-[11px] tabular-nums">
					0{activeStep + 1} / 05
				</div>
			</div>

			<div className="grid grid-cols-1 gap-3 md:grid-cols-5">
				{TYPE_IMPACT_NODES.map((node, index) => {
					const active = index === activeStep;

					return (
						<button
							key={node.title}
							type="button"
							onClick={() => onStepChange(index)}
							aria-pressed={active}
							className={cn(
								"border-border-subtle bg-surface-low min-w-0 rounded-[var(--control-radius)] border p-3 text-left transition-[background-color,border-color,color,transform] active:scale-[0.96] motion-reduce:active:scale-100",
								active && "border-border-strong bg-surface-high",
							)}
						>
							<div className="flex min-w-0 items-center gap-2">
								<Icon
									ssr
									aria-hidden="true"
									icon={node.icon}
									width={15}
									height={15}
									className="text-muted-foreground shrink-0"
								/>
								<div className="text-foreground font-chrome min-w-0 truncate text-sm font-semibold">
									{node.title}
								</div>
							</div>
							<p className="text-muted-foreground mt-1 text-xs leading-relaxed text-pretty">
								{node.description}
							</p>
						</button>
					);
				})}
			</div>

			<div className="border-border-subtle bg-surface-low mt-4 rounded-[var(--control-radius)] border p-3">
				<div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm leading-relaxed">
					<Icon
						ssr
						aria-hidden="true"
						icon="ph:warning-circle"
						width={15}
						height={15}
						className="text-primary"
					/>
					<span>
						Rename <span className="text-foreground font-mono">title</span> and
						TypeScript points at stale forms, SDK calls, filters, and view
						config.
					</span>
				</div>
			</div>
		</VisualAssetFrame>
	);
}

function EndToEndTypesSection() {
	const [activeStep, setActiveStep] = useState(4);

	const snippetLabels = [
		"collections/posts.ts",
		".generated/module.ts",
		"runtime — drizzle",
		"runtime — zod",
		"client.ts",
	];

	const snippets: ReactNode[] = [
		// Step 0: Field def
		<>
			<span className="text-primary font-semibold">collection</span>(
			<span className="text-[var(--syntax-string)]">"posts"</span>){`\n  .`}
			<span className="text-[var(--syntax-function)]">fields</span>
			{`(({ f }) => ({
    title:   f.`}
			<span className="text-[var(--syntax-function)]">text</span>(
			<span className="text-[var(--syntax-number)]">255</span>).
			<span className="text-[var(--syntax-function)]">required</span>
			{`(),
    content: f.`}
			<span className="text-[var(--syntax-function)]">richText</span>
			{`(),
    status:  f.`}
			<span className="text-[var(--syntax-function)]">select</span>
			{`([
      { value: `}
			<span className="text-[var(--syntax-string)]">"draft"</span>
			{`, label: `}
			<span className="text-[var(--syntax-string)]">"Draft"</span>
			{` },
      { value: `}
			<span className="text-[var(--syntax-string)]">"published"</span>
			{`, label: `}
			<span className="text-[var(--syntax-string)]">"Published"</span>
			{` },
    ]),
    author:  f.`}
			<span className="text-[var(--syntax-function)]">relation</span>(
			<span className="text-[var(--syntax-string)]">"users"</span>).
			<span className="text-[var(--syntax-function)]">required</span>
			{`(),
  }))`}
		</>,
		// Step 1: Codegen — actual generated module
		<>
			<span className="text-muted-foreground/60">
				{"// AUTO-GENERATED — DO NOT EDIT"}
			</span>
			{"\n"}
			<span className="text-primary font-semibold">import</span>
			{" _coll_posts "}
			<span className="text-primary font-semibold">from</span>{" "}
			<span className="text-[var(--syntax-string)]">
				"../collections/posts"
			</span>
			{"\n"}
			<span className="text-primary font-semibold">import</span>
			{" _coll_users "}
			<span className="text-primary font-semibold">from</span>{" "}
			<span className="text-[var(--syntax-string)]">
				"../collections/users"
			</span>
			{"\n"}
			<span className="text-primary font-semibold">import</span>
			{" _job_newsletter "}
			<span className="text-primary font-semibold">from</span>{" "}
			<span className="text-[var(--syntax-string)]">"../jobs/newsletter"</span>
			{"\n\n"}
			<span className="text-primary font-semibold">export interface</span>
			{" AppCollections {\n"}
			{"  posts: "}
			<span className="text-[var(--syntax-type)]">typeof</span>
			{" _coll_posts\n"}
			{"  users: "}
			<span className="text-[var(--syntax-type)]">typeof</span>
			{" _coll_users\n}\n\n"}
			<span className="text-primary font-semibold">const</span>
			{` _module = {
  name: `}
			<span className="text-[var(--syntax-string)]">"app"</span>
			{` as const,
  collections: {
    posts: _coll_posts,
    users: _coll_users,
  },
  jobs: { newsletter: _job_newsletter },
  globals: {},
  routes: {},
}

`}
			<span className="text-primary font-semibold">export default</span>
			{" _module"}
		</>,
		// Step 2: Drizzle table — runtime-derived
		<>
			<span className="text-muted-foreground/60">
				{"// Derived at runtime from .fields() definition"}
			</span>
			{"\n"}
			<span className="text-muted-foreground/60">
				{"// You never write this — questpie builds it"}
			</span>
			{"\n\n"}
			<span className="text-primary font-semibold">const</span>
			{" postsTable = "}
			<span className="text-[var(--syntax-function)]">pgTable</span>
			{`(`}
			<span className="text-[var(--syntax-string)]">"posts"</span>
			{`, {
  id:       `}
			<span className="text-[var(--syntax-function)]">serial</span>
			{`().primaryKey(),
  title:    `}
			<span className="text-[var(--syntax-function)]">varchar</span>
			{`({ length: `}
			<span className="text-[var(--syntax-number)]">255</span>
			{` }).notNull(),
  content:  `}
			<span className="text-[var(--syntax-function)]">jsonb</span>
			{`(), `}
			<span className="text-muted-foreground/60">{"// TipTap document"}</span>
			{`
  status:   `}
			<span className="text-[var(--syntax-function)]">statusEnum</span>
			{`(`}
			<span className="text-[var(--syntax-string)]">"status"</span>
			{`),
  authorId: `}
			<span className="text-[var(--syntax-function)]">integer</span>
			{`()
              .references(() => usersTable.id)
              .notNull(),
});`}
		</>,
		// Step 3: Zod schema — runtime-inferred
		<>
			<span className="text-muted-foreground/60">
				{"// Inferred at runtime from .fields()"}
			</span>
			{"\n"}
			<span className="text-muted-foreground/60">
				{"// Fully typed — change a field, types update"}
			</span>
			{"\n\n"}
			<span className="text-primary font-semibold">const</span>
			{" postsSchema = "}
			<span className="text-[var(--syntax-function)]">z</span>
			{`.`}
			<span className="text-[var(--syntax-function)]">object</span>
			{`({
  title:    z.`}
			<span className="text-[var(--syntax-function)]">string</span>
			{`().max(`}
			<span className="text-[var(--syntax-number)]">255</span>
			{`),
  content:  `}
			<span className="text-[var(--syntax-function)]">tiptapDocSchema</span>
			{`
              .optional(),
  status:   z.`}
			<span className="text-[var(--syntax-function)]">enum</span>
			{`([`}
			<span className="text-[var(--syntax-string)]">"draft"</span>
			{`, `}
			<span className="text-[var(--syntax-string)]">"published"</span>
			{`]),
  authorId: z.`}
			<span className="text-[var(--syntax-function)]">number</span>
			{`().int(),
});

`}
			<span className="text-muted-foreground/60">
				{"// type PostInput = z.infer<typeof postsSchema>"}
			</span>
		</>,
		// Step 4: Client SDK (current snippet)
		<>
			<span className="text-primary font-semibold">const</span>
			{` { docs } = `}
			<span className="text-primary font-semibold">await</span>
			{` client.collections.posts.`}
			<span className="text-[var(--syntax-function)]">find</span>
			{`({
  where: { status: { eq: `}
			<span className="text-[var(--syntax-string)]">"published"</span>
			{` } },
  orderBy: { createdAt: `}
			<span className="text-[var(--syntax-string)]">"desc"</span>
			{` },
  with: { author: `}
			<span className="text-primary font-semibold">true</span>
			{`, tags: `}
			<span className="text-primary font-semibold">true</span>
			{` },
  locale: `}
			<span className="text-[var(--syntax-string)]">"sk"</span>
			{`,
});

`}
			<span className="text-muted-foreground/60">
				{"// docs[0].title → string"}
			</span>
			{"\n"}
			<span className="text-muted-foreground/60">
				{"// docs[0].author → User"}
			</span>
			{"\n"}
			<span className="text-muted-foreground/60">
				{"// docs[0].tags → Tag[]"}
			</span>
		</>,
	];

	return (
		<>
			<SectionHeader
				num="05"
				title="Change the contract, see every consequence"
				subtitle="The field definition feeds generated registries, database shape, validation, client SDK calls, and admin forms. Rename or tighten a field and the compiler points to the fallout."
			/>

			<div className="grid gap-4">
				<TypeImpactAsset activeStep={activeStep} onStepChange={setActiveStep} />
				<CodePanel label={snippetLabels[activeStep]} key={`e2e-${activeStep}`}>
					<div className="admin-step-content">{snippets[activeStep]}</div>
				</CodePanel>
			</div>
		</>
	);
}

/* ─── Nav ─── */

const navItems = [
	{ label: "Docs", href: "/docs/$", type: "internal" as const },
	{
		label: "Examples",
		href: "/docs/$",
		type: "internal" as const,
		params: { _splat: "examples" },
	},
	{
		label: "GitHub",
		href: "https://github.com/questpie/questpie",
		type: "external" as const,
	},
];

function Nav() {
	const [isScrolled, setIsScrolled] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);

	useEffect(() => {
		const handleScroll = () => setIsScrolled(window.scrollY > 8);
		handleScroll();
		window.addEventListener("scroll", handleScroll, { passive: true });
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	return (
		<header
			className={cn(
				"fixed inset-x-0 top-0 z-50 h-14 border-b transition-[background-color,border-color] duration-[var(--motion-duration-base)] ease-[var(--motion-ease-standard)]",
				isScrolled
					? "border-border-subtle bg-background/40 backdrop-blur-md"
					: "border-transparent bg-transparent",
			)}
		>
			<div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-4 md:px-8">
				<div className="flex items-center gap-8">
					<Link to="/" className="flex items-center gap-2">
						<img
							src="/symbol/symbol-light.svg"
							alt="QUESTPIE"
							className="block h-6 w-auto sm:hidden dark:hidden"
						/>
						<img
							src="/symbol/symbol-dark.svg"
							alt="QUESTPIE"
							className="hidden h-6 w-auto dark:block dark:sm:hidden"
						/>
						<img
							src="/logo/horizontal-lockup-light.svg"
							alt="QUESTPIE"
							className="hidden h-5 w-auto sm:block dark:hidden"
						/>
						<img
							src="/logo/horizontal-lockup-dark.svg"
							alt="QUESTPIE"
							className="hidden h-5 w-auto dark:sm:block"
						/>
					</Link>

					<div className="text-muted-foreground font-chrome hidden items-center gap-1 text-sm font-medium md:flex">
						{navItems.map((item) =>
							item.type === "internal" ? (
								<Link
									key={item.label}
									to={item.href}
									params={item.params as never}
									className="hover:bg-surface-low hover:text-foreground rounded-[var(--control-radius-inner)] px-3 py-2 transition-[background-color,color]"
								>
									{item.label}
								</Link>
							) : (
								<a
									key={item.label}
									href={item.href}
									target="_blank"
									rel="noreferrer"
									className="hover:bg-surface-low hover:text-foreground rounded-[var(--control-radius-inner)] px-3 py-2 transition-[background-color,color]"
								>
									{item.label}
								</a>
							),
						)}
					</div>
				</div>

				<div className="flex items-center gap-2">
					<ThemeToggle />
					<Link
						to="/docs/$"
						params={{ _splat: "start-here/first-app" }}
						className={cn(primaryCta, "hidden sm:inline-flex")}
					>
						Create app
					</Link>
					<button
						type="button"
						className="text-muted-foreground hover:bg-surface-low hover:text-foreground flex size-10 items-center justify-center rounded-[var(--control-radius)] transition-[background-color,color,transform] active:scale-[0.96] motion-reduce:active:scale-100 md:hidden"
						onClick={() => setMobileOpen((v) => !v)}
						aria-label="Toggle navigation"
					>
						<Icon
							ssr
							icon={mobileOpen ? "ph:x" : "ph:list"}
							width={20}
							height={20}
						/>
					</button>
				</div>
			</div>

			{mobileOpen && (
				<div className="border-border-subtle bg-background absolute inset-x-0 top-full border-b p-4 md:hidden">
					<div className="mx-auto flex max-w-[1200px] flex-col gap-3">
						<Link
							to="/docs/$"
							className="text-muted-foreground hover:bg-surface-low hover:text-foreground font-chrome rounded-[var(--control-radius)] px-3 py-2 text-sm transition-[background-color,color]"
							onClick={() => setMobileOpen(false)}
						>
							Docs
						</Link>
						<Link
							to="/docs/$"
							params={{ _splat: "examples" }}
							className="text-muted-foreground hover:bg-surface-low hover:text-foreground font-chrome rounded-[var(--control-radius)] px-3 py-2 text-sm transition-[background-color,color]"
							onClick={() => setMobileOpen(false)}
						>
							Examples
						</Link>
						<a
							href="https://github.com/questpie/questpie"
							target="_blank"
							rel="noreferrer"
							className="text-muted-foreground hover:bg-surface-low hover:text-foreground font-chrome rounded-[var(--control-radius)] px-3 py-2 text-sm transition-[background-color,color]"
							onClick={() => setMobileOpen(false)}
						>
							GitHub
						</a>
						<div className="bg-border-subtle my-1 h-px" />
						<div className="flex items-center justify-between">
							<ThemeToggle />
							<Link
								to="/docs/$"
								params={{ _splat: "start-here/first-app" }}
								className={primaryCta}
								onClick={() => setMobileOpen(false)}
							>
								Create app
							</Link>
						</div>
					</div>
				</div>
			)}
		</header>
	);
}

/* ─── Footer ─── */

function LandingFooter() {
	return (
		<footer className="border-border-subtle border-t">
			<div className="mx-auto max-w-[1200px] px-4 py-12 md:px-8">
				<div className="grid grid-cols-1 gap-12 md:grid-cols-4">
					<div className="md:col-span-1">
						<Link to="/" className="mb-4 flex items-center">
							<img
								src="/logo/horizontal-lockup-light.svg"
								alt="QUESTPIE"
								className="block h-4 w-auto dark:hidden"
							/>
							<img
								src="/logo/horizontal-lockup-dark.svg"
								alt="QUESTPIE"
								className="hidden h-4 w-auto dark:block"
							/>
						</Link>
						<p className="text-muted-foreground mb-4 text-sm leading-relaxed">
							Open source server-first TypeScript framework for schema-driven
							products.
						</p>
						<div className="text-muted-foreground font-mono text-[11px]">
							MIT License
						</div>
					</div>
					<div>
						<div className="font-chrome mb-4 text-xs font-semibold">
							Product
						</div>
						<ul className="text-muted-foreground flex flex-col gap-2 text-sm">
							<li>
								<Link
									to="/docs/$"
									className="hover:text-foreground transition-colors"
								>
									Docs
								</Link>
							</li>
							<li>
								<Link
									to="/docs/$"
									params={{ _splat: "examples" }}
									className="hover:text-foreground transition-colors"
								>
									Examples
								</Link>
							</li>
							<li>
								<Link
									to="/docs/$"
									params={{ _splat: "start-here" }}
									className="hover:text-foreground transition-colors"
								>
									Getting Started
								</Link>
							</li>
							<li>
								<a
									href="https://github.com/questpie/questpie/releases"
									target="_blank"
									rel="noreferrer"
									className="hover:text-foreground transition-colors"
								>
									Releases
								</a>
							</li>
						</ul>
					</div>
					<div>
						<div className="font-chrome mb-4 text-xs font-semibold">
							Ecosystem
						</div>
						<ul className="text-muted-foreground flex flex-col gap-2 text-sm">
							<li>
								<Link
									to="/docs/$"
									params={{ _splat: "frontend/adapters/hono" }}
									className="hover:text-foreground transition-colors"
								>
									Hono
								</Link>
							</li>
							<li>
								<Link
									to="/docs/$"
									params={{ _splat: "frontend/adapters/elysia" }}
									className="hover:text-foreground transition-colors"
								>
									Elysia
								</Link>
							</li>
							<li>
								<Link
									to="/docs/$"
									params={{ _splat: "frontend/adapters/nextjs" }}
									className="hover:text-foreground transition-colors"
								>
									Next.js
								</Link>
							</li>
							<li>
								<Link
									to="/docs/$"
									params={{ _splat: "frontend/tanstack-query" }}
									className="hover:text-foreground transition-colors"
								>
									TanStack
								</Link>
							</li>
						</ul>
					</div>
					<div>
						<div className="font-chrome mb-4 text-xs font-semibold">
							Community
						</div>
						<ul className="text-muted-foreground flex flex-col gap-2 text-sm">
							<li>
								<a
									href="https://github.com/questpie/questpie"
									target="_blank"
									rel="noreferrer"
									className="hover:text-foreground transition-colors"
								>
									GitHub
								</a>
							</li>
							<li>
								<a
									href="https://github.com/questpie/questpie/issues"
									target="_blank"
									rel="noreferrer"
									className="hover:text-foreground transition-colors"
								>
									Issues
								</a>
							</li>
							<li>
								<a
									href="https://github.com/questpie/questpie/pulls"
									target="_blank"
									rel="noreferrer"
									className="hover:text-foreground transition-colors"
								>
									Pull Requests
								</a>
							</li>
						</ul>
					</div>
				</div>
				<div className="text-muted-foreground border-border-subtle mt-12 flex flex-col items-center justify-between gap-4 border-t pt-8 md:flex-row">
					<div className="text-[12px]">
						TypeScript &middot; Drizzle &middot; Zod &middot; Better Auth
						&middot; Hono
					</div>
				</div>
			</div>
		</footer>
	);
}

/* ─── Landing constants ─── */

const fn = "text-[var(--syntax-function)]";
const str = "text-[var(--syntax-string)]";
const num = "text-[var(--syntax-number)]";
const kw = "text-primary font-semibold";
const ctaBase =
	"font-chrome inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--control-radius)] px-4 py-2 text-sm font-medium transition-[background-color,color,border-color,transform] duration-[var(--motion-duration-base)] ease-[var(--motion-ease-standard)] active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100";
const primaryCta = cn(
	ctaBase,
	"bg-primary text-primary-foreground hover:bg-primary/85",
);
const secondaryCta = cn(
	ctaBase,
	"border-border-subtle bg-card text-foreground hover:bg-surface-low border",
);
const textCta = cn(
	ctaBase,
	"text-primary hover:bg-surface-low bg-transparent px-2",
);
const landingShell =
	"relative isolate overflow-hidden bg-background [background-image:linear-gradient(180deg,color-mix(in_srgb,var(--surface-low)_48%,transparent)_0,transparent_46rem)]";
const landingSection = "px-4 py-12 md:px-8 md:py-20";
const landingAmbientLayer =
	"pointer-events-none absolute inset-x-[-10%] inset-y-0 z-0 bg-[radial-gradient(ellipse_at_50%_-8rem,color-mix(in_srgb,var(--foreground)_8%,transparent)_0,transparent_40rem),radial-gradient(ellipse_at_18%_22rem,var(--ambient-top)_0,transparent_32rem),radial-gradient(ellipse_at_84%_20rem,color-mix(in_srgb,var(--primary)_7%,transparent)_0,transparent_28rem),radial-gradient(ellipse_at_50%_64rem,var(--ambient-edge)_0,transparent_56rem),linear-gradient(112deg,transparent_0_28%,var(--ambient-sheen)_46%,transparent_66%_100%)] opacity-55 motion-safe:animate-[landing-field-sweep_34s_var(--motion-ease-standard)_infinite_alternate] motion-reduce:opacity-30";
const landingTraceLayer =
	"pointer-events-none absolute inset-x-[-12%] inset-y-0 z-0 bg-[linear-gradient(116deg,transparent_0_31%,var(--ambient-trace)_31.15%_31.35%,transparent_31.55%_100%),linear-gradient(64deg,transparent_0_54%,var(--ambient-trace)_54.1%_54.22%,transparent_54.4%_100%)] [background-size:44rem_44rem,58rem_58rem] opacity-[0.28] [mask-image:radial-gradient(ellipse_at_50%_26rem,black_0,transparent_70rem)] motion-safe:animate-[landing-trace-drift_48s_linear_infinite_alternate] motion-reduce:opacity-[0.18] dark:opacity-[0.34]";
const landingParticleLayer =
	"pointer-events-none absolute inset-x-[-10%] inset-y-0 z-0 bg-[radial-gradient(circle_at_14px_18px,var(--ambient-particle)_0_1px,transparent_1.45px),radial-gradient(circle_at_88px_64px,var(--ambient-particle-accent)_0_1px,transparent_1.5px),radial-gradient(circle_at_150px_112px,var(--ambient-particle-muted)_0_1px,transparent_1.45px)] [background-size:180px_180px,260px_260px,340px_340px] opacity-[0.5] [mask-image:radial-gradient(ellipse_at_50%_28rem,black_0,transparent_78rem)] motion-safe:animate-[landing-particle-drift_80s_linear_infinite] motion-reduce:opacity-[0.24] dark:opacity-[0.62]";
const landingVignetteLayer =
	"pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(90deg,var(--background)_0,transparent_12%_88%,var(--background)_100%),linear-gradient(180deg,transparent_0_44%,var(--background)_100%)] opacity-75";
const landingNoiseLayer =
	"pointer-events-none absolute inset-0 z-0 opacity-[0.045] mix-blend-soft-light dark:opacity-[0.06] [background-image:url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http://www.w3.org/2000/svg%22%20width%3D%22160%22%20height%3D%22160%22%20viewBox%3D%220%200%20160%20160%22%3E%3Cfilter%20id%3D%22n%22%3E%3CfeTurbulence%20type%3D%22fractalNoise%22%20baseFrequency%3D%22.75%22%20numOctaves%3D%224%22%20stitchTiles%3D%22stitch%22/%3E%3C/filter%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20filter%3D%22url(%23n)%22%20opacity%3D%22.38%22/%3E%3C/svg%3E')] [background-size:160px_160px]";
const heroCodePanelEffect =
	"before:pointer-events-none before:absolute before:inset-0 before:z-10 before:bg-[linear-gradient(115deg,transparent_0_28%,var(--hero-shimmer,var(--glass-highlight))_48%,transparent_68%_100%)] before:opacity-0 motion-safe:before:animate-[hero-panel-sheen_9s_var(--motion-ease-standard)_infinite] motion-reduce:before:hidden";

type HeroPrimitive = {
	kind: string;
	title: string;
	description: string;
	icon: string;
	file: string;
	outputs: string[];
	snippet: ReactNode;
};

const HERO_PRIMITIVES: HeroPrimitive[] = [
	{
		kind: "Collection",
		title: "Model data once",
		description:
			"Fields, access, relations, validation, uploads, localization, and admin metadata start from the same contract.",
		icon: "ph:database",
		file: "collections/posts.ts",
		outputs: ["CRUD API", "Admin table", "Typed client", "Validation"],
		snippet: (
			<>
				<span className={kw}>collection</span>
				{"("}
				<span className={str}>"posts"</span>
				{")\n  ."}
				<span className={fn}>fields</span>
				{`(({ f }) => ({
    title:   f.`}
				<span className={fn}>text</span>
				{"("}
				<span className={num}>255</span>
				{")."}
				<span className={fn}>required</span>
				{`(),
    content: f.`}
				<span className={fn}>richText</span>
				{`().`}
				<span className={fn}>localized</span>
				{`(),
    status:  f.`}
				<span className={fn}>select</span>
				{`([`}
				<span className={str}>"draft"</span>
				{`, `}
				<span className={str}>"published"</span>
				{`]),
    author:  f.`}
				<span className={fn}>relation</span>
				{"("}
				<span className={str}>"users"</span>
				{")."}
				<span className={fn}>required</span>
				{`(),
  }))`}
			</>
		),
	},
	{
		kind: "Global",
		title: "Keep singleton state typed",
		description:
			"Settings, navigation, feature flags, and SEO live as first-class primitives instead of ad hoc config blobs.",
		icon: "ph:globe-hemisphere-west",
		file: "globals/site-settings.ts",
		outputs: ["Singleton API", "Admin form", "History", "Typed reads"],
		snippet: (
			<>
				<span className={kw}>global</span>
				{"("}
				<span className={str}>"siteSettings"</span>
				{")\n  ."}
				<span className={fn}>fields</span>
				{`(({ f }) => ({
    siteName: f.`}
				<span className={fn}>text</span>
				{`().`}
				<span className={fn}>required</span>
				{`(),
    nav:      f.`}
				<span className={fn}>blocks</span>
				{`(),
    ogImage:  f.`}
				<span className={fn}>upload</span>
				{`({ to: `}
				<span className={str}>"assets"</span>
				{` }),
  }))
  .`}
				<span className={fn}>options</span>
				{`({ versioning: `}
				<span className={kw}>true</span>
				{` })`}
			</>
		),
	},
	{
		kind: "Route",
		title: "Add typed product actions",
		description:
			"Custom HTTP behavior stays close to the app context, with typed input and access to collections, services, and queues.",
		icon: "ph:signpost",
		file: "routes/publish-post.ts",
		outputs: ["HTTP endpoint", "Typed input", "App context", "Client call"],
		snippet: (
			<>
				<span className={kw}>export default</span>{" "}
				<span className={fn}>route</span>
				{`()\n  .`}
				<span className={fn}>post</span>
				{`()\n  .`}
				<span className={fn}>schema</span>
				{`(z.object({ id: z.number() }))\n  .`}
				<span className={fn}>handler</span>
				{`(async ({ input, collections }) => {
    `}
				<span className={kw}>return</span>
				{` collections.posts.`}
				<span className={fn}>updateById</span>
				{`({
      id: input.id,
      data: { status: `}
				<span className={str}>"published"</span>
				{` },
    })
  })`}
			</>
		),
	},
	{
		kind: "Job",
		title: "Move workflows off-request",
		description:
			"Background work is declared with payload schema and the same rich context as routes and hooks.",
		icon: "ph:lightning",
		file: "jobs/send-newsletter.ts",
		outputs: [
			"Queue payload",
			"Worker handler",
			"Retryable work",
			"Typed context",
		],
		snippet: (
			<>
				<span className={kw}>export default</span>{" "}
				<span className={fn}>job</span>
				{`({
  name: `}
				<span className={str}>"sendNewsletter"</span>
				{`,
  schema: z.object({ postId: z.number() }),
  handler: async ({ payload, collections, email }) => {
    `}
				<span className={kw}>const</span>
				{` post = `}
				<span className={kw}>await</span>
				{` collections.posts.`}
				<span className={fn}>findOne</span>
				{`({ where: { id: payload.postId } })
    `}
				<span className={kw}>return</span>
				{` email.`}
				<span className={fn}>send</span>
				{`({ template: `}
				<span className={str}>"newsletter"</span>
				{`, data: post })
  },
})`}
			</>
		),
	},
	{
		kind: "Workflow",
		title: "Run durable flows",
		description:
			"Long-running processes persist each step, survive restarts, wait for external events, and stay visible in the admin UI.",
		icon: "ph:flow-arrow",
		file: "workflows/order-approval.ts",
		outputs: ["Replay", "Sleep", "Events", "Admin UI"],
		snippet: (
			<>
				<span className={kw}>export default</span>{" "}
				<span className={fn}>workflow</span>
				{`({
  name: `}
				<span className={str}>"order-approval"</span>
				{`,
  schema: z.object({ orderId: z.string() }),
  timeout: `}
				<span className={str}>"7d"</span>
				{`,
  handler: async ({ input, step, ctx }) => {
    `}
				<span className={kw}>const</span>
				{` order = `}
				<span className={kw}>await</span>
				{` step.`}
				<span className={fn}>run</span>
				{"("}
				<span className={str}>"load-order"</span>
				{`, async () =>
      ctx.collections.orders.`}
				<span className={fn}>findOne</span>
				{`({ where: { id: input.orderId } }),
    )

    `}
				<span className={kw}>await</span>
				{` step.`}
				<span className={fn}>sleep</span>
				{"("}
				<span className={str}>"fraud-window"</span>
				{`, `}
				<span className={str}>"10m"</span>
				{`)
    `}
				<span className={kw}>await</span>
				{` step.`}
				<span className={fn}>waitForEvent</span>
				{"("}
				<span className={str}>"approval"</span>
				{`, {
      event: `}
				<span className={str}>"order.approved"</span>
				{`,
      match: { orderId: input.orderId },
    })

    `}
				<span className={kw}>return</span>
				{` { ready: `}
				<span className={kw}>true</span>
				{`, orderId: order.id }
  },
})`}
			</>
		),
	},
	{
		kind: "Admin attach",
		title: "Project the workspace",
		description:
			"Views, components, actions, sidebar items, and dashboards attach to the same server primitives through registries.",
		icon: "ph:layout",
		file: "config/admin.ts",
		outputs: ["Sidebar", "Forms", "Tables", "Actions"],
		snippet: (
			<>
				<span className={kw}>export default</span>{" "}
				<span className={fn}>adminConfig</span>
				{`({
  sidebar: {
    sections: [{ id: `}
				<span className={str}>"content"</span>
				{`, title: `}
				<span className={str}>"Content"</span>
				{` }],
    items: [
      { sectionId: `}
				<span className={str}>"content"</span>
				{`, type: `}
				<span className={str}>"collection"</span>
				{`, collection: `}
				<span className={str}>"posts"</span>
				{` },
      { sectionId: `}
				<span className={str}>"content"</span>
				{`, type: `}
				<span className={str}>"global"</span>
				{`, global: `}
				<span className={str}>"siteSettings"</span>
				{` },
    ],
  },
  dashboard: {
    items: [{ type: `}
				<span className={str}>"stats"</span>
				{`, collection: `}
				<span className={str}>"posts"</span>
				{`, label: `}
				<span className={str}>"Published"</span>
				{` }],
  },
})`}
			</>
		),
	},
];

function HeroPrimitiveCarousel() {
	const defaultWorkflowIndex = HERO_PRIMITIVES.findIndex(
		(primitive) => primitive.kind === "Workflow",
	);
	const [activeIndex, setActiveIndex] = useState(
		defaultWorkflowIndex >= 0 ? defaultWorkflowIndex : 0,
	);
	const [isPaused, setIsPaused] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const hasRenderedRef = useRef(false);
	const isVisibleRef = useRef(true);
	const active = HERO_PRIMITIVES[activeIndex];

	useEffect(() => {
		hasRenderedRef.current = true;
	}, []);

	useEffect(() => {
		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
		if (reduceMotion.matches) return;

		const observer = new IntersectionObserver(
			([entry]) => {
				isVisibleRef.current = entry?.isIntersecting ?? true;
			},
			{ threshold: 0.35 },
		);

		if (rootRef.current) observer.observe(rootRef.current);

		const interval = window.setInterval(() => {
			if (isPaused || !isVisibleRef.current) return;
			setActiveIndex((current) => (current + 1) % HERO_PRIMITIVES.length);
		}, 4600);

		return () => {
			window.clearInterval(interval);
			observer.disconnect();
		};
	}, [isPaused]);

	return (
		<div
			ref={rootRef}
			data-hero-carousel
			className="relative"
			onMouseEnter={() => setIsPaused(true)}
			onMouseLeave={() => setIsPaused(false)}
			onFocus={() => setIsPaused(true)}
			onBlur={() => setIsPaused(false)}
		>
			<CodePanel
				label={
					<div className="flex min-w-0 items-center justify-between gap-3">
						<span className="truncate">{active.file}</span>
						<span className="border-border-subtle bg-card text-foreground font-chrome inline-flex shrink-0 items-center gap-1.5 rounded-[var(--control-radius-inner)] border px-2 py-1 text-[11px] font-medium">
							<Icon ssr icon={active.icon} width={12} height={12} />
							{active.kind}
						</span>
					</div>
				}
				data-hero-panel
				className={cn(
					"glass-panel h-[34rem] max-md:rounded-none max-md:border-0 max-md:[background-color:transparent] max-md:bg-transparent max-md:shadow-none max-md:[box-shadow:none] max-md:[backdrop-filter:none] max-md:[-webkit-backdrop-filter:none] sm:h-[32.75rem]",
					heroCodePanelEffect,
				)}
				contentClassName="min-h-0"
			>
				<div
					key={active.kind}
					className={cn(
						"flex h-full min-h-0 flex-col whitespace-normal",
						hasRenderedRef.current && "hero-carousel-slide",
					)}
				>
					<div className="mb-4 flex min-h-[6rem] shrink-0 items-start gap-3 sm:min-h-[5rem]">
						<div className="border-border-subtle bg-surface-low text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-[var(--control-radius)] border">
							<Icon ssr icon={active.icon} width={18} height={18} />
						</div>
						<div>
							<h3 className="text-foreground font-chrome text-base leading-snug font-semibold text-balance">
								{active.title}
							</h3>
							<p className="text-muted-foreground mt-1 text-sm leading-relaxed text-pretty">
								{active.description}
							</p>
						</div>
					</div>

					<div
						data-hero-code
						className="border-border-subtle bg-background/35 text-muted-foreground min-h-0 flex-1 overflow-auto rounded-[var(--control-radius)] border p-4 font-mono text-[12px] leading-[1.7] whitespace-pre sm:text-[13px]"
					>
						{active.snippet}
					</div>

					<div className="mt-4 grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
						{active.outputs.map((output) => (
							<div
								key={output}
								className="border-border-subtle bg-surface-low text-muted-foreground font-chrome rounded-[var(--control-radius-inner)] border px-2.5 py-2 text-xs font-medium"
							>
								{output}
							</div>
						))}
					</div>
				</div>
			</CodePanel>

			<div
				data-hero-controls
				className="mt-3 flex items-center justify-between gap-3"
			>
				<div className="flex items-center gap-1.5" aria-label="Hero primitives">
					{HERO_PRIMITIVES.map((primitive, index) => (
						<button
							key={primitive.kind}
							type="button"
							onClick={() => setActiveIndex(index)}
							className={cn(
								"border-border-subtle flex size-10 items-center justify-center rounded-[var(--control-radius-inner)] border transition-[background-color,color,border-color,transform,opacity] active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100",
								index === activeIndex
									? "border-border-strong bg-surface-high text-foreground opacity-100"
									: "bg-card text-muted-foreground hover:bg-surface-low hover:text-foreground opacity-70 hover:opacity-100",
							)}
							aria-label={`Show ${primitive.kind}`}
							aria-pressed={index === activeIndex}
						>
							<Icon ssr icon={primitive.icon} width={15} height={15} />
						</button>
					))}
				</div>
				<div className="text-muted-foreground hidden font-mono text-[11px] tabular-nums sm:block">
					{String(activeIndex + 1).padStart(2, "0")} /{" "}
					{String(HERO_PRIMITIVES.length).padStart(2, "0")}
				</div>
			</div>
		</div>
	);
}

const PRIMITIVE_SURFACES = [
	{
		icon: "ph:database",
		title: "Collections",
		description:
			"Model persisted resources with fields, relations, uploads, versions, hooks, and access rules.",
		outputs: ["CRUD", "Admin", "SDK"],
	},
	{
		icon: "ph:globe-hemisphere-west",
		title: "Globals",
		description:
			"Keep singleton settings typed, editable, versioned, and available to every frontend surface.",
		outputs: ["Settings", "History", "Forms"],
	},
	{
		icon: "ph:signpost",
		title: "Routes",
		description:
			"Add product actions with typed input, output, auth context, services, and collections.",
		outputs: ["HTTP", "Zod", "Context"],
	},
	{
		icon: "ph:lightning",
		title: "Jobs + workflows",
		description:
			"Move slow work into queue-backed handlers, or model long-running flows as replayed durable steps.",
		outputs: ["Queue", "Replay", "Cron"],
	},
	{
		icon: "ph:layout",
		title: "Admin attach",
		description:
			"Attach views, fields, actions, dashboards, and components through registries instead of hardcoded screens.",
		outputs: ["Views", "Actions", "Components"],
	},
	{
		icon: "ph:puzzle-piece",
		title: "Modules",
		description:
			"Package primitives and conventions so teams can share product capability, not boilerplate.",
		outputs: ["Plugins", "Factories", "Registries"],
	},
] as const;

const PROJECTION_OUTPUTS = [
	{
		icon: "ph:globe",
		label: "API",
		detail: "CRUD + routes",
	},
	{
		icon: "ph:check-circle",
		label: "Validation",
		detail: "runtime schemas",
	},
	{
		icon: "ph:cube",
		label: "Typed client",
		detail: "SDK + queries",
	},
	{
		icon: "ph:layout",
		label: "Admin",
		detail: "forms + tables",
	},
	{
		icon: "ph:activity",
		label: "Realtime",
		detail: "events + streams",
	},
	{
		icon: "ph:lightning",
		label: "Workflows",
		detail: "jobs + durable steps",
	},
] as const;

function ProjectionOutputCard({
	output,
}: {
	output: (typeof PROJECTION_OUTPUTS)[number];
}) {
	return (
		<div className="border-border-subtle bg-card/85 rounded-[var(--control-radius)] border p-3 shadow-[var(--surface-shadow)] backdrop-blur-sm">
			<div className="text-muted-foreground mb-2 flex items-center gap-2">
				<Icon ssr icon={output.icon} width={15} height={15} />
				<span className="text-foreground font-chrome text-sm font-semibold">
					{output.label}
				</span>
			</div>
			<div className="text-muted-foreground font-chrome text-xs">
				{output.detail}
			</div>
		</div>
	);
}

function ContractProjectionMap() {
	const leftOutputs = PROJECTION_OUTPUTS.slice(0, 3);
	const rightOutputs = PROJECTION_OUTPUTS.slice(3);

	return (
		<div
			data-contract-projection-map
			className="md:border-border-subtle md:bg-card relative mb-4 overflow-hidden p-0 md:rounded-[var(--surface-radius)] md:border md:p-6 md:shadow-[var(--surface-shadow)]"
		>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 hidden bg-[radial-gradient(circle_at_50%_50%,color-mix(in_srgb,var(--foreground)_6%,transparent)_0,transparent_32rem)] md:block"
			/>
			<svg
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 hidden h-full w-full text-[var(--border-subtle)] md:block"
				viewBox="0 0 100 100"
				preserveAspectRatio="none"
			>
				<path
					d="M50 50 C38 20 28 17 16 17"
					fill="none"
					stroke="currentColor"
					strokeWidth="0.35"
				/>
				<path
					d="M50 50 C36 50 29 50 16 50"
					fill="none"
					stroke="currentColor"
					strokeWidth="0.35"
				/>
				<path
					d="M50 50 C38 80 28 83 16 83"
					fill="none"
					stroke="currentColor"
					strokeWidth="0.35"
				/>
				<path
					d="M50 50 C62 20 72 17 84 17"
					fill="none"
					stroke="currentColor"
					strokeWidth="0.35"
				/>
				<path
					d="M50 50 C64 50 71 50 84 50"
					fill="none"
					stroke="currentColor"
					strokeWidth="0.35"
				/>
				<path
					d="M50 50 C62 80 72 83 84 83"
					fill="none"
					stroke="currentColor"
					strokeWidth="0.35"
				/>
			</svg>

			<div className="relative grid grid-cols-1 gap-4 md:grid-cols-[1fr_1.15fr_1fr] md:items-center">
				<div className="order-2 grid gap-3 md:order-none">
					{leftOutputs.map((output) => (
						<ProjectionOutputCard key={output.label} output={output} />
					))}
				</div>

				<div className="border-border-subtle bg-surface-low order-1 mx-auto flex min-h-48 w-full max-w-sm flex-col justify-center rounded-[var(--surface-radius)] border p-5 text-center shadow-[var(--surface-shadow)] md:order-none">
					<div className="text-muted-foreground border-border-subtle bg-card mx-auto mb-4 flex size-11 items-center justify-center rounded-[var(--control-radius)] border">
						<Icon ssr icon="ph:brackets-curly" width={20} height={20} />
					</div>
					<h3 className="text-foreground text-xl leading-tight font-semibold text-balance">
						Product contract
					</h3>
					<p className="text-muted-foreground mx-auto mt-2 max-w-60 text-sm leading-relaxed text-pretty">
						Fields, routes, jobs, access, admin config, and module registries
						share one typed source.
					</p>
					<div className="mt-4 flex flex-wrap justify-center gap-1.5">
						{["schema", "runtime", "workspace"].map((tag) => (
							<span
								key={tag}
								className="border-border-subtle bg-card text-muted-foreground font-chrome rounded-[var(--control-radius-inner)] border px-2 py-1 text-[11px] font-medium"
							>
								{tag}
							</span>
						))}
					</div>
				</div>

				<div className="order-3 grid gap-3 md:order-none">
					{rightOutputs.map((output) => (
						<ProjectionOutputCard key={output.label} output={output} />
					))}
				</div>
			</div>
		</div>
	);
}

function OneSchemaSection() {
	return (
		<>
			<SectionHeader
				num="01"
				title="Primitives become product surfaces"
				subtitle="QUESTPIE is not another layer of boilerplate. You define a primitive once, codegen records it in a typed registry, and every runtime surface reads from that same source."
			/>

			<ContractProjectionMap />

			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{PRIMITIVE_SURFACES.map((surface) => (
					<div
						key={surface.title}
						className="border-border-subtle bg-card hover:bg-surface-low rounded-[var(--surface-radius)] border p-5 shadow-[var(--surface-shadow)] transition-[background-color,border-color]"
					>
						<div className="text-muted-foreground mb-3 flex items-center gap-2">
							<Icon ssr icon={surface.icon} width={17} height={17} />
							<span className="text-foreground font-chrome text-sm font-semibold">
								{surface.title}
							</span>
						</div>
						<p className="text-muted-foreground min-h-16 text-sm leading-relaxed text-pretty">
							{surface.description}
						</p>
						<div className="mt-4 flex flex-wrap gap-1.5">
							{surface.outputs.map((output) => (
								<span
									key={output}
									className="border-border-subtle bg-surface-low text-muted-foreground font-chrome inline-flex rounded-[var(--control-radius-inner)] border px-2 py-1 text-[11px] font-medium"
								>
									{output}
								</span>
							))}
						</div>
					</div>
				))}
			</div>
		</>
	);
}

/* ─── §06 Module composition asset ─── */

const MODULE_INPUTS = [
	{
		icon: "ph:package",
		title: "Starter",
		description: "auth, assets, users",
	},
	{
		icon: "ph:layout",
		title: "Admin",
		description: "views, fields, dashboard",
	},
	{
		icon: "ph:clipboard-text",
		title: "Audit",
		description: "global hooks",
	},
	{
		icon: "ph:flow-arrow",
		title: "Workflows",
		description: "durable steps, events, cron",
	},
	{
		icon: "ph:puzzle-piece",
		title: "Your module",
		description: "domain capability",
	},
] as const;

const MODULE_OUTPUTS = [
	{
		icon: "ph:globe",
		title: "API",
		description: "runtime handlers",
	},
	{
		icon: "ph:monitor",
		title: "Workspace",
		description: "admin surfaces",
	},
	{
		icon: "ph:terminal",
		title: "SDK",
		description: "typed clients",
	},
] as const;

function ModuleCompositionAsset() {
	return (
		<VisualAssetFrame asset="module-composition" className="mb-4">
			<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
				<div>
					<div className="text-muted-foreground font-mono text-[11px] font-medium">
						Module graph
					</div>
					<h3 className="text-foreground mt-1 text-lg leading-tight font-semibold text-balance">
						Defaults and custom packages meet at the app contract
					</h3>
				</div>
				<div className="border-border-subtle bg-surface-low text-muted-foreground rounded-[var(--control-radius-inner)] border px-2.5 py-1 font-mono text-[11px]">
					registry-first
				</div>
			</div>

			<div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.05fr_1fr] lg:items-center">
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
					{MODULE_INPUTS.map((module) => (
						<VisualNode
							key={module.title}
							icon={module.icon}
							title={module.title}
							description={module.description}
						/>
					))}
				</div>

				<div className="border-border-subtle bg-surface-high mx-auto flex min-h-56 w-full max-w-sm flex-col justify-center rounded-[var(--surface-radius)] border p-5 text-center shadow-[var(--surface-shadow)]">
					<div className="text-muted-foreground border-border-subtle bg-card mx-auto mb-4 flex size-12 items-center justify-center rounded-[var(--control-radius)] border">
						<Icon
							ssr
							aria-hidden="true"
							icon="ph:cube-focus"
							width={22}
							height={22}
						/>
					</div>
					<h3 className="text-foreground text-xl leading-tight font-semibold text-balance">
						QUESTPIE app
					</h3>
					<p className="text-muted-foreground mx-auto mt-2 max-w-64 text-sm leading-relaxed text-pretty">
						Modules merge state, configs, registries, builders, and callbacks
						without hardcoded runtime names.
					</p>
					<div className="mt-4 flex flex-wrap justify-center gap-1.5">
						{["merge", "augment", "project"].map((tag) => (
							<span
								key={tag}
								className="border-border-subtle bg-card text-muted-foreground font-chrome rounded-[var(--control-radius-inner)] border px-2 py-1 text-[11px] font-medium"
							>
								{tag}
							</span>
						))}
					</div>
				</div>

				<div className="grid gap-3">
					{MODULE_OUTPUTS.map((output) => (
						<VisualNode
							key={output.title}
							icon={output.icon}
							title={output.title}
							description={output.description}
						/>
					))}
				</div>
			</div>
		</VisualAssetFrame>
	);
}

const DEV_LOOP_STEPS = [
	{
		icon: "ph:eye",
		title: "Watch",
		description: "Detect convention changes",
		command: "questpie dev",
		output: "watching questpie/server/**",
		detail: "Change detected: collections/posts.ts",
		badge: "file watcher armed",
	},
	{
		icon: "ph:gear-six",
		title: "Generate",
		description: "Emit registries and types",
		command: "questpie dev",
		output: "generated .generated/index.ts",
		detail: "App types, registries, and module imports refreshed",
		badge: "typed registry updated",
	},
	{
		icon: "ph:shield-warning",
		title: "Validate",
		description: "Catch missing projections",
		command: "questpie dev",
		output: "renderer contract checked",
		detail: "Missing admin projection fails before runtime",
		badge: "contract clean",
	},
	{
		icon: "ph:rocket-launch",
		title: "Ship",
		description: "Move with confidence",
		command: "questpie dev",
		output: "API, admin, and client surfaces in sync",
		detail: "Keep coding without a manual sync step",
		badge: "ready to ship",
	},
] as const;

function DevLoopAsset() {
	const [activeStep, setActiveStep] = useState(0);
	const [isPaused, setIsPaused] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const isVisibleRef = useRef(true);
	const active = DEV_LOOP_STEPS[activeStep];

	useEffect(() => {
		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
		if (reduceMotion.matches) return;

		const observer = new IntersectionObserver(
			([entry]) => {
				isVisibleRef.current = entry?.isIntersecting ?? true;
			},
			{ threshold: 0.35 },
		);

		if (rootRef.current) observer.observe(rootRef.current);

		const interval = window.setInterval(() => {
			if (isPaused || !isVisibleRef.current) return;
			setActiveStep((current) => (current + 1) % DEV_LOOP_STEPS.length);
		}, 4200);

		return () => {
			window.clearInterval(interval);
			observer.disconnect();
		};
	}, [isPaused]);

	return (
		<VisualAssetFrame asset="dev-loop" className="mb-4">
			<div
				ref={rootRef}
				onMouseEnter={() => setIsPaused(true)}
				onMouseLeave={() => setIsPaused(false)}
				onFocus={() => setIsPaused(true)}
				onBlur={() => setIsPaused(false)}
			>
				<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
					<div>
						<div className="text-muted-foreground font-mono text-[11px] font-medium">
							Development loop
						</div>
						<h3 className="text-foreground mt-1 text-lg leading-tight font-semibold text-balance">
							Feedback arrives while the contract is still fresh
						</h3>
					</div>
					<div className="border-border-subtle bg-surface-low text-muted-foreground rounded-[var(--control-radius-inner)] border px-2.5 py-1 font-mono text-[11px] tabular-nums">
						{String(activeStep + 1).padStart(2, "0")} /{" "}
						{String(DEV_LOOP_STEPS.length).padStart(2, "0")}
					</div>
				</div>

				<div className="grid grid-cols-1 gap-3 md:grid-cols-4">
					{DEV_LOOP_STEPS.map((step, index) => {
						const selected = index === activeStep;

						return (
							<button
								key={step.title}
								type="button"
								onClick={() => setActiveStep(index)}
								aria-pressed={selected}
								className={cn(
									"border-border-subtle bg-surface-low min-w-0 rounded-[var(--control-radius)] border p-3 text-left transition-[background-color,border-color,color,transform,opacity] active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100",
									selected
										? "border-border-strong bg-surface-high text-foreground"
										: "hover:bg-surface-high opacity-85 hover:opacity-100",
								)}
							>
								<div className="flex min-w-0 items-center gap-2">
									<Icon
										ssr
										aria-hidden="true"
										icon={step.icon}
										width={15}
										height={15}
										className="text-muted-foreground shrink-0"
									/>
									<div className="text-foreground font-chrome min-w-0 truncate text-sm font-semibold">
										{step.title}
									</div>
								</div>
								<p className="text-muted-foreground mt-1 text-xs leading-relaxed text-pretty">
									{step.description}
								</p>
								<div className="text-muted-foreground mt-3 font-mono text-[10px] tabular-nums">
									{String(index + 1).padStart(2, "0")}
								</div>
							</button>
						);
					})}
				</div>

				<div className="border-border-subtle bg-surface-low mt-4 grid gap-3 rounded-[var(--control-radius)] border p-3 md:grid-cols-[1fr_auto] md:items-center">
					<div
						key={active.title}
						aria-live="polite"
						className="admin-step-content font-mono text-[12px] leading-relaxed"
					>
						<div className="text-foreground">
							<span className="text-primary">$</span> {active.command}
						</div>
						<div className="text-muted-foreground">
							<span className="text-[var(--status-success)]">✓</span>{" "}
							{active.output}
						</div>
						<div className="text-muted-foreground/70">{active.detail}</div>
					</div>
					<div className="border-border-subtle bg-card text-muted-foreground font-chrome rounded-[var(--control-radius-inner)] border px-3 py-2 text-xs">
						{active.badge}
					</div>
				</div>
			</div>
		</VisualAssetFrame>
	);
}

/* ─── Conversion Sections ─── */

const START_COMMAND = "bun create questpie";

const TRUST_ITEMS = [
	{ icon: "ph:code", label: "TypeScript + ESM" },
	{ icon: "ph:database", label: "Drizzle + Zod" },
	{ icon: "ph:shield-check", label: "Better Auth ready" },
	{ icon: "ph:globe", label: "OpenAPI output" },
	{ icon: "ph:git-branch", label: "MIT open source" },
	{ icon: "ph:plugs-connected", label: "Hono, Elysia, Next" },
] as const;

const FIRST_RUN_STEPS = [
	{
		time: "00",
		title: "Create app",
		command: START_COMMAND,
		detail: "Starter, config, imports, and file conventions are ready.",
	},
	{
		time: "02",
		title: "Model schema",
		command: 'collection("posts").fields(({ f }) => ...)',
		detail: "Fields, access, relations, and admin metadata share one source.",
	},
	{
		time: "05",
		title: "Run dev",
		command: "questpie dev",
		detail: "Generated app types, CRUD API, admin screens, and client SDK.",
	},
	{
		time: "10",
		title: "Extend",
		command: "route().post().handler(async ({ collections }) => ...)",
		detail: "Add product actions, jobs, workflows, services, or modules.",
	},
] as const;

const PRODUCT_PATHS = [
	{
		icon: "ph:article",
		title: "Content app",
		description:
			"Collections, globals, uploads, localization, blocks, preview, and editor workflow.",
		href: "/docs/$",
		params: { _splat: "examples/barbershop" },
		link: "See example",
	},
	{
		icon: "ph:layout",
		title: "SaaS admin",
		description:
			"CRUD, access rules, dashboards, forms, actions, filters, and custom views.",
		href: "/docs/$",
		params: { _splat: "backend/data-modeling/collections" },
		link: "Model data",
	},
	{
		icon: "ph:flow-arrow",
		title: "Workflow backend",
		description:
			"Routes, jobs, queues, durable steps, cron, emails, realtime, and audit trails.",
		href: "/docs/$",
		params: { _splat: "backend/business-logic/workflows" },
		link: "Run workflows",
	},
	{
		icon: "ph:puzzle-piece",
		title: "Framework module",
		description:
			"Package conventions, builders, registries, fields, views, components, and adapters.",
		href: "/docs/$",
		params: { _splat: "extend/building-a-module" },
		link: "Build module",
	},
] as const;

function CopyCommandButton({ command }: { command: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(command);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1500);
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			className="text-muted-foreground hover:bg-surface-high hover:text-foreground flex size-9 shrink-0 items-center justify-center rounded-[var(--control-radius-inner)] transition-[background-color,color,transform] active:scale-[0.96] motion-reduce:active:scale-100"
			aria-label={copied ? "Command copied" : "Copy command"}
		>
			<Icon ssr icon={copied ? "ph:check" : "ph:copy"} width={15} height={15} />
		</button>
	);
}

function HeroCommandBox() {
	return (
		<div className="border-border-subtle bg-card/80 mb-8 max-w-xl overflow-hidden rounded-[var(--surface-radius)] border shadow-[var(--surface-shadow)] backdrop-blur-sm">
			<div className="border-border-subtle bg-surface-low/70 flex items-center justify-between gap-3 border-b px-3 py-2">
				<div className="text-muted-foreground font-mono text-[11px] font-medium">
					create your first app
				</div>
				<div className="text-muted-foreground font-mono text-[10px]">
					Bun starter
				</div>
			</div>
			<div className="flex min-w-0 items-center gap-3 px-4 py-3">
				<span className="text-primary font-mono">$</span>
				<code className="text-foreground min-w-0 flex-1 overflow-x-auto font-mono text-sm whitespace-nowrap">
					{START_COMMAND}
				</code>
				<CopyCommandButton command={START_COMMAND} />
			</div>
			<div className="border-border-subtle bg-border-subtle grid grid-cols-2 gap-px border-t sm:grid-cols-4">
				{["CRUD API", "Admin UI", "Typed client", "Jobs"].map((output) => (
					<div
						key={output}
						className="bg-card text-muted-foreground font-chrome px-3 py-2 text-xs font-medium"
					>
						{output}
					</div>
				))}
			</div>
		</div>
	);
}

function TrustStrip() {
	return (
		<section className="px-4 pb-10 md:px-8 md:pb-14">
			<div className="border-border-subtle bg-card/70 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--surface-radius)] border shadow-[var(--surface-shadow)] backdrop-blur-sm sm:grid-cols-3 lg:grid-cols-6">
				{TRUST_ITEMS.map((item) => (
					<div
						key={item.label}
						className="bg-card/70 text-muted-foreground font-chrome flex min-h-16 items-center gap-2 px-3 py-3 text-xs font-medium"
					>
						<Icon
							ssr
							aria-hidden="true"
							icon={item.icon}
							width={15}
							height={15}
							className="shrink-0"
						/>
						<span className="min-w-0 text-pretty">{item.label}</span>
					</div>
				))}
			</div>
		</section>
	);
}

function FirstRunSection() {
	return (
		<section className={landingSection}>
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
				<div>
					<div className="text-muted-foreground mb-3 font-mono text-xs font-medium">
						First run
					</div>
					<h2 className="text-foreground mb-4 text-3xl leading-tight font-semibold text-balance md:text-4xl">
						From empty repo to working product surfaces.
					</h2>
					<p className="text-muted-foreground max-w-xl text-lg leading-[1.65] text-pretty">
						QUESTPIE is built for teams that want schema, runtime behavior, and
						workspace UI to move together. Start with a collection, then keep
						adding real product behavior without creating parallel definitions.
					</p>
					<div className="mt-6 flex flex-wrap gap-3">
						<Link
							to="/docs/$"
							params={{ _splat: "start-here/first-app" }}
							className={primaryCta}
						>
							Create first app{" "}
							<Icon ssr icon="ph:arrow-right" width={16} height={16} />
						</Link>
						<Link
							to="/docs/$"
							params={{ _splat: "examples" }}
							className={secondaryCta}
						>
							Browse examples{" "}
							<Icon ssr icon="ph:squares-four" width={16} height={16} />
						</Link>
					</div>
				</div>

				<div className="grid gap-3">
					{FIRST_RUN_STEPS.map((step) => (
						<div
							key={step.title}
							className="border-border-subtle bg-card grid gap-3 rounded-[var(--surface-radius)] border p-4 shadow-[var(--surface-shadow)] sm:grid-cols-[4rem_1fr] sm:items-start"
						>
							<div className="text-primary font-mono text-sm font-semibold tabular-nums">
								{step.time}m
							</div>
							<div className="min-w-0">
								<div className="text-foreground font-chrome mb-2 text-sm font-semibold">
									{step.title}
								</div>
								<div className="border-border-subtle bg-surface-low text-muted-foreground flex min-w-0 items-center gap-2 rounded-[var(--control-radius-inner)] border px-3 py-2 font-mono text-xs">
									<span className="text-primary">$</span>
									<span className="min-w-0 truncate">{step.command}</span>
								</div>
								<p className="text-muted-foreground mt-2 text-sm leading-relaxed text-pretty">
									{step.detail}
								</p>
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

function ProductPathSection() {
	return (
		<section className={landingSection}>
			<div className="mb-8 md:mb-12">
				<div className="text-muted-foreground mb-3 font-mono text-xs font-medium">
					Choose your path
				</div>
				<h2 className="text-foreground mb-4 text-3xl leading-tight font-semibold text-balance md:text-4xl">
					Start where your product hurts.
				</h2>
				<p className="text-muted-foreground max-w-2xl text-lg leading-[1.65] text-pretty">
					Use QUESTPIE as a CMS backbone, an internal workspace framework, a
					workflow runtime, or a module system. The contract stays typed across
					every surface.
				</p>
			</div>

			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{PRODUCT_PATHS.map((path) => (
					<Link
						key={path.title}
						to={path.href}
						params={path.params}
						className="border-border-subtle bg-card hover:bg-surface-low group flex min-h-64 flex-col rounded-[var(--surface-radius)] border p-5 shadow-[var(--surface-shadow)] transition-[background-color,border-color,transform] active:scale-[0.96] motion-reduce:active:scale-100"
					>
						<div className="text-muted-foreground border-border-subtle bg-surface-low mb-5 flex size-11 items-center justify-center rounded-[var(--control-radius)] border">
							<Icon ssr icon={path.icon} width={19} height={19} />
						</div>
						<h3 className="text-foreground mb-2 text-lg leading-tight font-semibold text-balance">
							{path.title}
						</h3>
						<p className="text-muted-foreground flex-1 text-sm leading-relaxed text-pretty">
							{path.description}
						</p>
						<div className="text-primary font-chrome mt-5 flex items-center gap-2 text-sm font-medium">
							{path.link}
							<Icon
								ssr
								icon="ph:arrow-right"
								width={15}
								height={15}
								className="transition-transform group-hover:translate-x-0.5"
							/>
						</div>
					</Link>
				))}
			</div>
		</section>
	);
}

/* ═══════════════════════════════════════════════
   LANDING PAGE
   ═══════════════════════════════════════════════ */

export function LandingPage() {
	useEffect(() => {
		const revealVisible = () => {
			document.querySelectorAll("[data-reveal]").forEach((el) => {
				const rect = el.getBoundingClientRect();
				const isVisible =
					rect.top < window.innerHeight * 0.92 &&
					rect.bottom > window.innerHeight * 0.08;

				if (isVisible) el.setAttribute("data-visible", "");
			});
		};

		const obs = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting) e.target.setAttribute("data-visible", "");
				}
			},
			{ threshold: 0.1 },
		);
		document.querySelectorAll("[data-reveal]").forEach((el) => obs.observe(el));
		revealVisible();
		window.addEventListener("scroll", revealVisible, { passive: true });
		window.addEventListener("resize", revealVisible);

		return () => {
			obs.disconnect();
			window.removeEventListener("scroll", revealVisible);
			window.removeEventListener("resize", revealVisible);
		};
	}, []);

	return (
		<div className="landing bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
			<Nav />

			<main className={landingShell}>
				<div
					aria-hidden="true"
					data-bg-layer="ambient"
					className={landingAmbientLayer}
				/>
				<div
					aria-hidden="true"
					data-bg-layer="trace"
					className={landingTraceLayer}
				/>
				<div
					aria-hidden="true"
					data-bg-layer="particles"
					className={landingParticleLayer}
				/>
				<div
					aria-hidden="true"
					data-bg-layer="vignette"
					className={landingVignetteLayer}
				/>
				<div
					aria-hidden="true"
					data-bg-layer="noise"
					className={landingNoiseLayer}
				/>

				<div className="relative z-10 mx-auto max-w-[1200px]">
					{/* ─── HERO ─── */}
					<section className="mt-14 px-4 py-12 md:px-8 md:py-16 lg:py-20">
						<div className="grid grid-cols-1 items-center gap-8 md:gap-12 lg:grid-cols-2 lg:gap-24">
							<div>
								<div className="text-muted-foreground font-chrome mb-5 text-sm font-medium">
									Backend, admin, API, and workflows
								</div>
								<h1 className="text-foreground mb-6 text-4xl leading-[1.08] font-semibold text-balance md:text-5xl lg:text-6xl">
									Ship a typed product backend from one schema.
								</h1>
								<p className="text-muted-foreground mb-8 max-w-xl text-lg leading-[1.6] md:text-xl">
									Define fields, access, routes, jobs, workflows, and admin
									config once. QUESTPIE projects that contract into CRUD APIs,
									workspace screens, validation, typed clients, OpenAPI, and
									runtime services.
								</p>
								<HeroCommandBox />
								<div className="flex flex-wrap items-center gap-3 sm:gap-4 lg:mb-12">
									<Link
										to="/docs/$"
										params={{ _splat: "start-here/first-app" }}
										className={primaryCta}
									>
										Create first app{" "}
										<Icon ssr icon="ph:arrow-right" width={16} height={16} />
									</Link>
									<a href="#schema-output" className={secondaryCta}>
										View generated output{" "}
										<Icon ssr icon="ph:arrow-down" width={16} height={16} />
									</a>
								</div>
							</div>

							<div className="relative">
								<HeroPrimitiveCarousel />
							</div>
						</div>
					</section>

					<TrustStrip />

					<Reveal>
						<FirstRunSection />
					</Reveal>

					<Reveal>
						<ProductPathSection />
					</Reveal>

					{/* ─── §01 ONE SCHEMA — Hover highlight ─── */}
					<Reveal>
						<section id="schema-output" className={landingSection}>
							<OneSchemaSection />
						</section>
					</Reveal>

					{/* ─── §02 FILE CONVENTIONS ─── */}
					<Reveal>
						<section className={landingSection}>
							<FileConventionsSection />
						</section>
					</Reveal>

					{/* ─── §03 SWAP ANYTHING ─── */}
					<Reveal>
						<section className={landingSection}>
							<SwapAnythingSection />
						</section>
					</Reveal>

					{/* ─── §04 ADMIN SHOWCASE ─── */}
					<Reveal>
						<section className={landingSection}>
							<AdminShowcaseSection />
						</section>
					</Reveal>

					{/* ─── §05 END-TO-END TYPES ─── */}
					<Reveal>
						<section className={landingSection}>
							<EndToEndTypesSection />
						</section>
					</Reveal>

					{/* ─── §06 COMPOSABLE ─── */}
					<Reveal>
						<section className={landingSection}>
							<SectionHeader
								num="06"
								title="Compose the framework around your product"
								subtitle="Core features, admin surfaces, audit trails, and your own packages compose through the same conventions. Keep the defaults where they fit and swap the parts that should be yours."
							/>

							<ModuleCompositionAsset />
						</section>
					</Reveal>

					{/* ─── §07 DX — Staggered terminal reveal ─── */}
					<section className={landingSection}>
						<Reveal>
							<SectionHeader
								num="07"
								title="Fast feedback while you build"
								subtitle="The CLI watches convention files, regenerates typed registries, scaffolds common resources, and fails early when a server contract is missing a client projection."
							/>
						</Reveal>

						<Reveal>
							<DevLoopAsset />
						</Reveal>
					</section>

					{/* ─── CTA ─── */}
					<section className="px-4 py-24 text-center md:px-8 md:py-32">
						<div className="mb-8">
							<img
								src="/symbol/symbol-light.svg"
								alt="Q"
								className="mx-auto block h-12 w-12 dark:hidden"
							/>
							<img
								src="/symbol/symbol-dark.svg"
								alt="Q"
								className="mx-auto hidden h-12 w-12 dark:block"
							/>
						</div>
						<h2 className="text-foreground mb-6 text-4xl leading-tight font-semibold text-balance md:text-5xl">
							Start with one schema. Ship every surface.
						</h2>
						<div className="border-border-subtle bg-card mb-8 inline-flex items-center gap-4 rounded-[var(--surface-radius)] border px-6 py-3 shadow-[var(--surface-shadow)]">
							<span className="text-primary font-mono">$</span>
							<span className="font-mono text-[14px]">bun create questpie</span>
						</div>
						<div className="flex flex-wrap items-center justify-center gap-4">
							<Link
								to="/docs/$"
								params={{ _splat: "start-here/first-app" }}
								className={primaryCta}
							>
								Create first app{" "}
								<Icon ssr icon="ph:arrow-right" width={16} height={16} />
							</Link>
							<Link
								to="/docs/$"
								params={{ _splat: "examples" }}
								className={secondaryCta}
							>
								Browse examples{" "}
								<Icon ssr icon="ph:arrow-right" width={16} height={16} />
							</Link>
							<a
								href="https://github.com/questpie/questpie"
								target="_blank"
								rel="noreferrer"
								className={textCta}
							>
								<Icon ssr icon="ph:github-logo" width={16} height={16} /> Star
								on GitHub
							</a>
						</div>
					</section>
				</div>
			</main>

			<LandingFooter />
		</div>
	);
}
