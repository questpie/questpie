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

function ResourceGroup({
	kind,
	identities,
}: Readonly<{ kind: string; identities: readonly string[] }>) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="capitalize">{kind}</CardTitle>
				<CardDescription>
					{identities.length} declared in this build
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-wrap gap-2">
				{identities.map((identity) => (
					<Badge key={identity} variant="secondary">
						{identity.slice(kind.length + 1)}
					</Badge>
				))}
			</CardContent>
		</Card>
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

	const byKind = new Map<string, string[]>();
	for (const resource of loaded.catalog.resources) {
		const group = byKind.get(resource.kind) ?? [];
		group.push(resource.identity);
		byKind.set(resource.kind, group);
	}

	return (
		<main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
			<header className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold">{loaded.catalog.application}</h1>
				<p className="text-muted-foreground text-sm">
					{loaded.catalog.operations.length} operations ·{" "}
					{loaded.catalog.migrations.length} migrations ·{" "}
					{loaded.explain.policies.length} policies
				</p>
			</header>
			<Separator />
			{[...byKind.entries()]
				.sort(([left], [right]) => (left < right ? -1 : 1))
				.map(([kind, identities]) => (
					<ResourceGroup key={kind} kind={kind} identities={identities} />
				))}
		</main>
	);
}
