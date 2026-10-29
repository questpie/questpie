import { resolve } from "node:path";

import { sentryVitePlugin } from "@sentry/vite-plugin";

export interface QuestpieSentryViteOptions {
	org?: string;
	project?: string;
	/**
	 * Release the maps are uploaded for. Pass the same value to the server
	 * adapter and the browser reporter.
	 */
	release: string;
	/**
	 * Upload token. Read it from a CI secret — it is a build credential and
	 * never part of the bundle. Without one, debug ids are still injected and
	 * maps are still deleted, but nothing is uploaded.
	 * @default process.env.SENTRY_AUTH_TOKEN
	 */
	authToken?: string;
	/** Self-hosted Sentry URL. */
	url?: string;
	/**
	 * Source maps to delete after the build so the web server cannot serve
	 * them, also when nothing was uploaded. `[]` keeps them for a later upload.
	 * @default `<root>/<build.outDir>/**\/*.map`
	 */
	filesToDeleteAfterUpload?: string | string[];
}

/** The plugin that hides and deletes source maps; a structural Vite plugin. */
export interface QuestpieSentrySourcemapsPlugin {
	name: string;
	config(config: {
		build?: { sourcemap?: unknown };
	}): { build: { sourcemap: "hidden" } } | undefined;
	configResolved(config: { root: string; build: { outDir: string } }): void;
}

/**
 * Source maps for Sentry: debug-id injection, upload, and keeping the maps
 * private.
 *
 * - `build.sourcemap` defaults to `"hidden"`: maps are generated but bundles
 *   carry no `sourceMappingURL` comment pointing at them.
 * - After the build, the maps are deleted from the build output, uploaded or not.
 * - Release injection, commit association, deploys, telemetry and component
 *   annotation are off; the release is passed explicitly at runtime instead.
 */
export function questpieSentryVite(
	options: QuestpieSentryViteOptions,
): Array<
	QuestpieSentrySourcemapsPlugin | ReturnType<typeof sentryVitePlugin>[number]
> {
	const authToken = options.authToken ?? process.env.SENTRY_AUTH_TOKEN;
	let resolveDeleteGlobs!: (globs: string[]) => void;
	const defaultDeleteGlobs = new Promise<string[]>((done) => {
		resolveDeleteGlobs = done;
	});

	const hideSourcemaps: QuestpieSentrySourcemapsPlugin = {
		name: "questpie-sentry-sourcemaps",
		config(config: { build?: { sourcemap?: unknown } }) {
			if (config.build?.sourcemap === undefined) {
				return { build: { sourcemap: "hidden" as const } };
			}
			return undefined;
		},
		configResolved(config: { root: string; build: { outDir: string } }) {
			resolveDeleteGlobs([
				resolve(config.root, config.build.outDir, "**/*.map"),
			]);
		},
	};

	return [
		hideSourcemaps,
		...sentryVitePlugin({
			org: options.org,
			project: options.project,
			authToken,
			url: options.url,
			telemetry: false,
			release: {
				name: options.release,
				inject: false,
				create: Boolean(authToken),
				finalize: Boolean(authToken),
				setCommits: false,
				deploy: false,
			},
			sourcemaps: {
				disable: authToken ? false : "disable-upload",
				filesToDeleteAfterUpload:
					options.filesToDeleteAfterUpload ?? defaultDeleteGlobs,
			},
			reactComponentAnnotation: { enabled: false },
		}),
	];
}
