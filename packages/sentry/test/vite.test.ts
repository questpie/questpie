import { describe, expect, it, mock } from "bun:test";

let received: any;
mock.module("@sentry/vite-plugin", () => ({
	sentryVitePlugin: (options: unknown) => {
		received = options;
		return [{ name: "sentry-vite-plugin" }];
	},
}));

const { questpieSentryVite } = await import("../src/vite.js");

describe("questpieSentryVite", () => {
	it("hides source maps by default and deletes them after upload", async () => {
		const [hide, sentry] = questpieSentryVite({
			release: "web@1.0.0",
			org: "o",
			project: "p",
			authToken: "ci-token",
		}) as any[];
		expect(sentry.name).toBe("sentry-vite-plugin");
		expect(hide.config({})).toEqual({ build: { sourcemap: "hidden" } });
		expect(hide.config({ build: { sourcemap: true } })).toBeUndefined();

		hide.configResolved({ root: "/repo/app", build: { outDir: "dist" } });
		expect(await received.sourcemaps.filesToDeleteAfterUpload).toEqual([
			"/repo/app/dist/**/*.map",
		]);
		expect(received).toMatchObject({
			authToken: "ci-token",
			telemetry: false,
			release: {
				name: "web@1.0.0",
				inject: false,
				create: true,
				finalize: true,
				setCommits: false,
				deploy: false,
			},
			sourcemaps: { disable: false },
			reactComponentAnnotation: { enabled: false },
		});
	});

	it("injects debug ids but uploads nothing without a token", () => {
		const previous = process.env.SENTRY_AUTH_TOKEN;
		delete process.env.SENTRY_AUTH_TOKEN;
		try {
			questpieSentryVite({ release: "web@1.0.0" });
			expect(received.sourcemaps.disable).toBe("disable-upload");
			expect(received.release.create).toBe(false);
		} finally {
			if (previous !== undefined) process.env.SENTRY_AUTH_TOKEN = previous;
		}
	});
});
