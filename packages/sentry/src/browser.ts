import {
	buildEvent,
	createDelivery,
	type DeliveryOptions,
	registeredFiles,
} from "./envelope.js";
import { createRecentSet } from "./recent.js";
import { sanitizeError } from "./sanitize.js";

export type BrowserErrorKind =
	| "boundary"
	| "global"
	| "unhandledrejection"
	| "manual";

export interface BrowserErrorInfo {
	kind?: BrowserErrorKind;
	/** Route TEMPLATE (e.g. TanStack `routeId` `/invite/$token`), never `location.href`. */
	route?: string;
}

export interface BrowserErrorReporterOptions extends DeliveryOptions {
	/**
	 * Your own error class names that are safe to send as the exception type.
	 * Built-in names are always sent; any other name is reported as `Error`.
	 */
	errorNames?: readonly string[];
	/**
	 * Reports per rolling minute; more are dropped. Stops a render loop from
	 * flooding the project. @default 30
	 */
	maxReportsPerMinute?: number;
	/**
	 * Read stacks the runtime formats on first access (V8 in Node and
	 * browsers, Gecko). Off by default: such a stack is produced by the
	 * runtime's stack formatter, which runs whatever `Error.prepareStackTrace`
	 * the error's realm has installed (Node's default, a source-map hook, or an
	 * app's own) exactly as reading `error.stack` does. Without it, frames are
	 * sent only for stacks that are already plain data (Bun, an assigned
	 * string). With it, the formatter that runs is whatever is installed and
	 * may itself call getters or other code; only the reporter's own reads of
	 * `name`, `message` and `code` are kept free of getters and proxies. The
	 * reporter itself never modifies globals.
	 * @default false
	 */
	formattedStacks?: boolean;
}

export interface BrowserErrorReporter {
	/** Report an error. Never throws; returns immediately. */
	report(error: unknown, info?: BrowserErrorInfo): void;
	flush(timeoutMs?: number): Promise<boolean>;
	/** Flush, then ignore further reports. */
	close(timeoutMs?: number): Promise<boolean>;
}

const ROUTE = /^[A-Za-z0-9_\-./:$*[\]{}()]{1,256}$/;
const KINDS = new Set<BrowserErrorKind>([
	"boundary",
	"global",
	"unhandledrejection",
	"manual",
]);

/**
 * Browser error reporter on `@sentry/core` primitives — no `@sentry/browser`
 * init, so no global handlers, breadcrumbs (console, clicks, navigation,
 * fetch), replay, tracing, sessions or user/IP collection are installed
 * behind your back. Install exactly the capture points you want with
 * {@link installGlobalErrorHandlers} and {@link createRouterErrorReporter}.
 *
 * The envelope carries no URL, user agent or cookies, and is sent with
 * `referrerPolicy: "no-referrer"` and `credentials: "omit"`. Sentry still sees
 * the connecting IP on direct ingest — use `tunnel` and/or the project's
 * "Prevent Storing of IP Addresses" setting.
 */
export function createBrowserErrorReporter(
	options: BrowserErrorReporterOptions,
): BrowserErrorReporter {
	const delivery = createDelivery(options, { keepalive: true });
	const recent = createRecentSet(60_000);
	const maxPerMinute = options.maxReportsPerMinute ?? 30;
	const release = options.release ?? injectedRelease();
	const sanitizeOptions = {
		errorNames: new Set(options.errorNames),
		formattedStacks: options.formattedStacks === true,
	};
	let windowStart = Date.now();
	let sentInWindow = 0;
	let closed = false;

	return {
		report(error, info = {}) {
			if (!delivery || closed) return;
			try {
				if (recent.check(error)) return;
				const now = Date.now();
				if (now - windowStart >= 60_000) {
					windowStart = now;
					sentInWindow = 0;
				}
				if (sentInWindow >= maxPerMinute) return;
				sentInWindow += 1;

				const kind = info.kind && KINDS.has(info.kind) ? info.kind : "manual";
				const route =
					typeof info.route === "string" && ROUTE.test(info.route)
						? info.route
						: undefined;
				const tags: Record<string, string> = {
					"questpie.source": "browser",
					"questpie.kind": kind,
				};
				if (route) tags["route"] = route;
				void delivery
					.send(
						buildEvent({
							platform: "javascript",
							exceptions: sanitizeError(error, {
								...sanitizeOptions,
								registeredFiles: registeredFiles(),
							}),
							value: route ? `Browser error on ${route}` : "Browser error",
							mechanism: `questpie.browser.${kind}`,
							handled: kind === "manual" || kind === "boundary",
							transaction: route,
							tags,
							release,
							environment: options.environment,
						}),
					)
					.catch(() => {});
			} catch {
				// Reporting must never break the page.
			}
		},
		flush(timeoutMs = 2_000) {
			return delivery ? delivery.flush(timeoutMs) : Promise.resolve(true);
		},
		async close(timeoutMs = 2_000) {
			closed = true;
			return delivery ? delivery.flush(timeoutMs) : true;
		},
	};
}

type EventTargetLike = {
	addEventListener(type: string, listener: (event: any) => void): void;
	removeEventListener(type: string, listener: (event: any) => void): void;
};

/**
 * Report uncaught errors and unhandled rejections. Observes only — default
 * browser handling (console output) is not prevented. Returns an uninstaller.
 */
export function installGlobalErrorHandlers(
	reporter: BrowserErrorReporter,
	target: EventTargetLike = globalThis as unknown as EventTargetLike,
	getRoute?: () => string | undefined,
): () => void {
	const onError = (event: { error?: unknown }) => {
		// Cross-origin "Script error." events carry no error object: skip.
		if (event?.error !== undefined && event.error !== null) {
			reporter.report(event.error, {
				kind: "global",
				route: safeRoute(getRoute),
			});
		}
	};
	const onRejection = (event: { reason?: unknown }) => {
		reporter.report(event?.reason, {
			kind: "unhandledrejection",
			route: safeRoute(getRoute),
		});
	};
	target.addEventListener("error", onError);
	target.addEventListener("unhandledrejection", onRejection);
	return () => {
		target.removeEventListener("error", onError);
		target.removeEventListener("unhandledrejection", onRejection);
	};
}

/**
 * Bridge for TanStack Router / Start error boundaries:
 *
 * ```ts
 * createRouter({
 *   defaultOnCatch: createRouterErrorReporter(reporter, () =>
 *     router.state.matches.at(-1)?.routeId),
 * })
 * ```
 *
 * `routeId` is the route TEMPLATE, so `/invite/$token` is reported, not the
 * token. Works with any router that exposes an `onCatch(error)` hook.
 */
export function createRouterErrorReporter(
	reporter: BrowserErrorReporter,
	getRoute?: () => string | undefined,
): (error: unknown) => void {
	return (error) =>
		reporter.report(error, { kind: "boundary", route: safeRoute(getRoute) });
}

function safeRoute(getRoute?: () => string | undefined): string | undefined {
	try {
		return getRoute?.();
	} catch {
		return undefined;
	}
}

/** `SENTRY_RELEASE` injected by the bundler plugin, read without getters. */
function injectedRelease(): string | undefined {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"SENTRY_RELEASE",
		);
		const value =
			descriptor && "value" in descriptor ? descriptor.value : undefined;
		const id =
			value && typeof value === "object"
				? Object.getOwnPropertyDescriptor(value, "id")
				: undefined;
		return id && "value" in id && typeof id.value === "string"
			? id.value
			: undefined;
	} catch {
		return undefined;
	}
}
