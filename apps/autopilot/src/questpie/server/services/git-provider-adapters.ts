import { service } from "questpie/services";

export type GitProviderKind = "github" | "gitlab" | "generic_git";
export type ChangeRequestKind = "pull_request" | "merge_request";

export interface GitRemoteReference {
	provider: GitProviderKind;
	remoteUrl: string;
	webUrl: string | null;
	owner: string | null;
	repo: string | null;
	host: string | null;
}

export interface GitDiffContext {
	provider: GitProviderKind;
	remoteUrl: string;
	webUrl: string | null;
	defaultBranch: string | null;
	compareUrl: string | null;
	changeRequestKind: ChangeRequestKind | null;
	changeRequestUrl: string | null;
}

interface ParsedRemote {
	raw: string;
	host: string | null;
	owner: string | null;
	repo: string | null;
}

interface GitProviderAdapter {
	kind: GitProviderKind;
	changeRequestKind: ChangeRequestKind | null;
	match(remote: ParsedRemote): boolean;
	toReference(remote: ParsedRemote): GitRemoteReference;
	buildCompareUrl(
		ref: GitRemoteReference,
		base: string,
		head: string,
	): string | null;
	buildChangeRequestUrl(
		ref: GitRemoteReference,
		base: string,
		head: string,
	): string | null;
}

const githubAdapter: GitProviderAdapter = {
	kind: "github",
	changeRequestKind: "pull_request",
	match: (remote) =>
		remote.host === "github.com" && !!remote.owner && !!remote.repo,
	toReference: (remote) => ({
		provider: "github",
		remoteUrl: remote.raw,
		webUrl: `https://github.com/${remote.owner}/${remote.repo}`,
		owner: remote.owner,
		repo: remote.repo,
		host: remote.host,
	}),
	buildCompareUrl: (ref, base, head) =>
		ref.webUrl
			? `${ref.webUrl}/compare/${encodeGitRef(base)}...${encodeGitRef(head)}`
			: null,
	buildChangeRequestUrl: (ref, base, head) =>
		ref.webUrl
			? `${ref.webUrl}/compare/${encodeGitRef(base)}...${encodeGitRef(head)}?expand=1`
			: null,
};

const gitlabAdapter: GitProviderAdapter = {
	kind: "gitlab",
	changeRequestKind: "merge_request",
	match: (remote) =>
		!!remote.host?.includes("gitlab") && !!remote.owner && !!remote.repo,
	toReference: (remote) => ({
		provider: "gitlab",
		remoteUrl: remote.raw,
		webUrl: `https://${remote.host}/${remote.owner}/${remote.repo}`,
		owner: remote.owner,
		repo: remote.repo,
		host: remote.host,
	}),
	buildCompareUrl: (ref, base, head) =>
		ref.webUrl
			? `${ref.webUrl}/-/compare/${encodeGitRef(base)}...${encodeGitRef(head)}`
			: null,
	buildChangeRequestUrl: (ref, base, head) => {
		if (!ref.webUrl) return null;
		const params = new URLSearchParams({
			"merge_request[source_branch]": head,
			"merge_request[target_branch]": base,
		});
		return `${ref.webUrl}/-/merge_requests/new?${params.toString()}`;
	},
};

const genericGitAdapter: GitProviderAdapter = {
	kind: "generic_git",
	changeRequestKind: null,
	match: () => true,
	toReference: (remote) => ({
		provider: "generic_git",
		remoteUrl: remote.raw,
		webUrl:
			remote.host && remote.owner && remote.repo
				? `https://${remote.host}/${remote.owner}/${remote.repo}`
				: null,
		owner: remote.owner,
		repo: remote.repo,
		host: remote.host,
	}),
	buildCompareUrl: () => null,
	buildChangeRequestUrl: () => null,
};

const ADAPTERS: GitProviderAdapter[] = [
	githubAdapter,
	gitlabAdapter,
	genericGitAdapter,
];

export function resolveGitRemote(
	remoteUrl: string | null | undefined,
): GitRemoteReference | null {
	if (!remoteUrl?.trim()) return null;
	const parsed = parseGitRemote(remoteUrl.trim());
	const adapter =
		ADAPTERS.find((candidate) => candidate.match(parsed)) ?? genericGitAdapter;
	return adapter.toReference(parsed);
}

export function buildGitDiffContext(input: {
	remoteUrl: string | null | undefined;
	defaultBranch?: string | null;
	base: string;
	head: string;
}): GitDiffContext | null {
	const remote = resolveGitRemote(input.remoteUrl);
	if (!remote) return null;

	const adapter =
		ADAPTERS.find((candidate) => candidate.kind === remote.provider) ??
		genericGitAdapter;
	return {
		provider: remote.provider,
		remoteUrl: remote.remoteUrl,
		webUrl: remote.webUrl,
		defaultBranch: input.defaultBranch ?? null,
		compareUrl: adapter.buildCompareUrl(remote, input.base, input.head),
		changeRequestKind: adapter.changeRequestKind,
		changeRequestUrl: adapter.buildChangeRequestUrl(
			remote,
			input.base,
			input.head,
		),
	};
}

function parseGitRemote(raw: string): ParsedRemote {
	const scpMatch = raw.match(/^git@([^:]+):(.+)$/);
	if (scpMatch) return parsePath(raw, scpMatch[1]!, scpMatch[2]!);

	try {
		const url = new URL(raw);
		return parsePath(raw, url.hostname, url.pathname.replace(/^\/+/, ""));
	} catch {
		return { raw, host: null, owner: null, repo: null };
	}
}

function parsePath(raw: string, host: string, path: string): ParsedRemote {
	const parts = path
		.replace(/\.git$/, "")
		.split("/")
		.filter(Boolean);
	if (parts.length < 2) return { raw, host, owner: null, repo: null };
	return {
		raw,
		host,
		owner: parts.slice(0, -1).join("/"),
		repo: parts[parts.length - 1]!,
	};
}

function encodeGitRef(ref: string): string {
	return ref.split("/").map(encodeURIComponent).join("/");
}

export default service({
	lifecycle: "singleton",
	create: () => ({
		resolveRemote: resolveGitRemote,
		buildDiffContext: buildGitDiffContext,
	}),
});
