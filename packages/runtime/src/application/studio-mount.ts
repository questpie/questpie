/**
 * The same-origin Studio mount.
 *
 * `docs/v4/beta1-build-spec.md:29` names `apps/studio/` a "minimal same-origin
 * operational projection". Same-origin means the application serves it, and
 * `app.fetch` previously served exactly one path — the Operation wire. That was
 * an absence rather than a prohibition: ADR-0014 says `createApp()` exposes
 * `fetch` and says nothing about how many paths it answers.
 *
 * The mount is a read-only asset surface and nothing else. It carries no
 * Operation, no durable read, and no application data, so it raises no
 * disclosure question of its own: what Studio may see is decided by what it can
 * call, not by how its bytes arrive. That separation is what keeps the
 * inspection nondisclosure contract the only place disclosure is reasoned about.
 */
export const studioAssetPath = "/_questpie/studio";

const shell = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QUESTPIE Studio</title>
</head>
<body>
<div id="studio"></div>
</body>
</html>
`;

/**
 * Answers the Studio asset path, or `null` so the caller falls through to the
 * Operation wire. Returning `null` rather than a 404 keeps the mount composable:
 * it claims one path and declines to speak for any other.
 */
export async function studioBundleResponse(
	request: Request,
): Promise<Response | null> {
	if (new URL(request.url).pathname !== studioAssetPath) return null;
	if (request.method !== "GET" && request.method !== "HEAD")
		return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
	return new Response(request.method === "HEAD" ? null : shell, {
		status: 200,
		headers: {
			"content-type": "text/html; charset=utf-8",
			// The shell is build-identical and carries no application data, but it
			// must never be shared across deployments by a proxy.
			"cache-control": "no-store",
			"x-content-type-options": "nosniff",
		},
	});
}

export const studioArtifactPath = "/_questpie/studio/artifacts";

/**
 * The artifacts Studio projects, named one by one.
 *
 * An allow-list rather than a passthrough is the safety property here.
 * `artifactFiles` also carries the wire contract, the durable kernel contract,
 * and the executable inventory; naming what Studio needs means a future
 * artifact cannot become browser-reachable merely by being added to the build.
 *
 * Every entry is compiled public contract — what the application declares, not
 * what it has done — so serving it raises no disclosure question. Operational
 * facts never appear here and are not reachable from the browser at all.
 */
export const studioArtifactAllowListed: readonly string[] = Object.freeze([
	"collection-operation-explain.json",
	"committed-migrations.json",
	"manifest.json",
	"operation-contracts.json",
	"reaction-projection.json",
	"relational-explain.json",
]);

export async function studioArtifactResponse(
	request: Request,
	artifactFiles: Readonly<Record<string, Uint8Array | string>>,
): Promise<Response | null> {
	if (new URL(request.url).pathname !== studioArtifactPath) return null;
	if (request.method !== "GET" && request.method !== "HEAD")
		return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
	const decoder = new TextDecoder();
	const served: Record<string, unknown> = {};
	for (const path of studioArtifactAllowListed) {
		const bytes = artifactFiles[path];
		if (bytes === undefined) continue;
		const text = typeof bytes === "string" ? bytes : decoder.decode(bytes);
		served[path] = JSON.parse(text);
	}
	return new Response(
		request.method === "HEAD" ? null : JSON.stringify(served),
		{
			status: 200,
			headers: {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-store",
				"x-content-type-options": "nosniff",
			},
		},
	);
}
