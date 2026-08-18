import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import {
	projectStudioCatalog,
	projectStudioExplain,
	type StudioCatalog,
	type StudioExplain,
	type StudioProvenance,
	type StudioResource,
} from "./projection";

/**
 * Studio explains one compiled application.
 *
 * The page fetches the artifact path the application serves and runs the same
 * producer the tests drive, so there is one projection rather than a second
 * one in the browser. Everything rendered here is compiled contract — what the
 * application declares — and no operational fact reaches this page at all.
 */
const artifactEndpoint = "/_questpie/studio/artifacts";

type Loaded = Readonly<{ catalog: StudioCatalog; explain: StudioExplain }>;

async function loadProjection(): Promise<Loaded> {
	const response = await fetch(artifactEndpoint);
	if (!response.ok)
		throw new Error(`Studio artifacts are unavailable (${response.status})`);
	const served = (await response.json()) as Record<string, unknown>;
	const bytes = Object.fromEntries(
		Object.entries(served).map(([path, value]) => [
			path,
			JSON.stringify(value),
		]),
	);
	return {
		catalog: projectStudioCatalog(bytes),
		explain: projectStudioExplain(bytes),
	};
}

/**
 * The sources actually present in a set of facts, derived rather than assumed.
 *
 * Every fact in one group shares an artifact today, so this renders as a single
 * line. It is computed from the facts anyway: if a group ever draws on two
 * artifacts, the view says both instead of naming one and being wrong.
 */
function sourcesOf(
	facts: readonly Readonly<{ provenance: StudioProvenance }>[],
): readonly string[] {
	return [...new Set(facts.map((fact) => fact.provenance.artifact))].sort();
}

/**
 * The Runtime Build a set of facts came from, or `null` when they disagree.
 *
 * Disagreement is the case worth rendering: facts from two builds joined into
 * one view is exactly what carrying the identity is meant to make visible.
 */
function buildOf(
	facts: readonly Readonly<{ provenance: StudioProvenance }>[],
): string | null {
	const builds = new Set(facts.map((fact) => fact.provenance.runtimeBuild));
	return builds.size === 1 ? [...builds][0]! : null;
}

function Provenance({
	facts,
}: Readonly<{ facts: readonly Readonly<{ provenance: StudioProvenance }>[] }>) {
	const build = buildOf(facts);
	return (
		<span className="text-muted-foreground/70 text-xs">
			from {sourcesOf(facts).join(", ")}
			{build === null ? (
				<strong className="text-destructive"> · mixed builds</strong>
			) : (
				<> · build {build.slice(0, 12)}</>
			)}
		</span>
	);
}

function ResourceGroup({
	kind,
	resources,
}: Readonly<{ kind: string; resources: readonly StudioResource[] }>) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="capitalize">{kind}</CardTitle>
				<CardDescription className="flex flex-wrap items-baseline gap-2">
					<span>{resources.length} declared in this build</span>
					<Provenance facts={resources} />
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-wrap gap-2">
				{resources.map((resource) => (
					<Badge key={resource.identity} variant="secondary">
						{resource.identity.slice(kind.length + 1)}
					</Badge>
				))}
			</CardContent>
		</Card>
	);
}

/**
 * One counted fact and the artifact it came from.
 *
 * The header joins three artifacts into one line, which is precisely the shape
 * `freshness-and-provenance.md` refuses to present as a single authoritative
 * record. Each count carries its own source instead.
 */
function Stat({
	label,
	facts,
}: Readonly<{
	label: string;
	facts: readonly Readonly<{ provenance: StudioProvenance }>[];
}>) {
	return (
		<span className="flex flex-col">
			<span>
				{facts.length} {label}
			</span>
			<Provenance facts={facts} />
		</span>
	);
}

export function StudioApp() {
	const [loaded, setLoaded] = useState<Loaded | null>(null);
	const [failure, setFailure] = useState<string | null>(null);

	useEffect(() => {
		loadProjection()
			.then(setLoaded)
			.catch((error: unknown) => setFailure(String(error)));
	}, []);

	if (failure)
		return (
			<main className="mx-auto max-w-3xl p-8">
				<Card>
					<CardHeader>
						<CardTitle>Studio cannot read this build</CardTitle>
						{/* Absence is stated, never drawn as an empty list. */}
						<CardDescription>{failure}</CardDescription>
					</CardHeader>
				</Card>
			</main>
		);

	if (!loaded)
		return <main className="mx-auto max-w-3xl p-8">Reading the build…</main>;

	const byKind = new Map<string, StudioResource[]>();
	for (const resource of loaded.catalog.resources) {
		const group = byKind.get(resource.kind) ?? [];
		group.push(resource);
		byKind.set(resource.kind, group);
	}

	return (
		<main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
			<header className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold">{loaded.catalog.application}</h1>
				<div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-2 text-sm">
					<Stat label="operations" facts={loaded.catalog.operations} />
					<Stat label="migrations" facts={loaded.catalog.migrations} />
					<Stat label="policies" facts={loaded.explain.policies} />
				</div>
			</header>
			<Separator />
			{[...byKind.entries()]
				.sort(([left], [right]) => (left < right ? -1 : 1))
				.map(([kind, resources]) => (
					<ResourceGroup key={kind} kind={kind} resources={resources} />
				))}
		</main>
	);
}
