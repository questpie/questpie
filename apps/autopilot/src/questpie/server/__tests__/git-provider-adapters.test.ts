import { describe, expect, it } from "vitest";

import {
	buildGitDiffContext,
	resolveGitRemote,
} from "../services/git-provider-adapters";

describe("git-provider-adapters", () => {
	it("resolves GitHub remotes and compare links", () => {
		const remote = resolveGitRemote("git@github.com:questpie/autopilot.git");
		expect(remote).toMatchObject({
			provider: "github",
			owner: "questpie",
			repo: "autopilot",
		});

		const diff = buildGitDiffContext({
			remoteUrl: "git@github.com:questpie/autopilot.git",
			defaultBranch: "main",
			base: "main",
			head: "autopilot/task-1",
		});
		expect(diff?.compareUrl).toBe(
			"https://github.com/questpie/autopilot/compare/main...autopilot/task-1",
		);
		expect(diff?.changeRequestKind).toBe("pull_request");
	});

	it("falls back to generic git metadata", () => {
		const remote = resolveGitRemote("ssh://git.example.test/team/repo.git");
		expect(remote).toMatchObject({
			provider: "generic_git",
			host: "git.example.test",
			owner: "team",
			repo: "repo",
		});
	});
});
