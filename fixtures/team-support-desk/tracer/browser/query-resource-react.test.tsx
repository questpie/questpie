import { expect, expectTypeOf, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { JSDOM } from "jsdom";
import { useQueryResource } from "questpie/react";
import { StrictMode, act, createElement } from "react";
import { createRoot } from "react-dom/client";

type Snapshot =
	| Readonly<{ kind: "pending" }>
	| Readonly<{ kind: "ready"; value: Readonly<{ title: string }> }>;

function installDom(): () => void {
	const dom = new JSDOM('<div id="root"></div>', {
		url: "http://questpie.test",
	});
	const previous = {
		IS_REACT_ACT_ENVIRONMENT: Reflect.get(
			globalThis,
			"IS_REACT_ACT_ENVIRONMENT",
		),
		document: globalThis.document,
		navigator: globalThis.navigator,
		window: globalThis.window,
	};
	Object.assign(globalThis, {
		IS_REACT_ACT_ENVIRONMENT: true,
		document: dom.window.document,
		navigator: dom.window.navigator,
		window: dom.window,
	});
	return () => {
		dom.window.close();
		Object.assign(globalThis, previous);
	};
}

test("projects a Query Resource through React 19 without owning its identity or lifetime", async () => {
	const restore = installDom();
	let snapshot: Snapshot = Object.freeze({ kind: "pending" });
	const listeners = new Set<() => void>();
	let activeSubscriptions = 0;
	let maximumActiveSubscriptions = 0;
	let starts = 0;
	let stops = 0;
	const resource = Object.freeze({
		getSnapshot: () => snapshot,
		subscribe: (notify: () => void) => {
			starts += 1;
			activeSubscriptions += 1;
			maximumActiveSubscriptions = Math.max(
				maximumActiveSubscriptions,
				activeSubscriptions,
			);
			listeners.add(notify);
			let active = true;
			return () => {
				if (!active) return;
				active = false;
				stops += 1;
				activeSubscriptions -= 1;
				listeners.delete(notify);
			};
		},
	});

	function Screen() {
		const current = useQueryResource(resource);
		expectTypeOf(current).toEqualTypeOf<Snapshot>();
		return current.kind === "ready" ? current.value.title : current.kind;
	}

	try {
		const container = document.querySelector("#root");
		if (!(container instanceof window.HTMLElement))
			throw new TypeError("React test root is missing");
		const root = createRoot(container);
		await act(async () => {
			root.render(createElement(StrictMode, null, createElement(Screen)));
		});
		expect(container.textContent).toBe("pending");
		expect(maximumActiveSubscriptions).toBe(1);

		await act(async () => {
			snapshot = Object.freeze({
				kind: "ready",
				value: Object.freeze({ title: "Generated resource" }),
			});
			for (const listener of listeners) listener();
		});
		expect(container.textContent).toBe("Generated resource");

		await act(async () => root.unmount());
		expect(starts).toBeGreaterThanOrEqual(1);
		expect(stops).toBe(starts);
		expect(activeSubscriptions).toBe(0);
	} finally {
		restore();
	}
});

test("ships one optional-peer React subpath with no second client owner", () => {
	const packageRoot = resolve(import.meta.dir, "../../../../packages/questpie");
	const manifest = JSON.parse(
		readFileSync(resolve(packageRoot, "package.json"), "utf8"),
	) as Readonly<{
		version: string;
		dependencies?: Readonly<Record<string, string>>;
		peerDependencies?: Readonly<Record<string, string>>;
		peerDependenciesMeta?: Readonly<
			Record<string, Readonly<{ optional?: boolean }>>
		>;
	}>;
	const source = readFileSync(resolve(packageRoot, "src/react.ts"), "utf8");

	expect(manifest.peerDependencies?.react).toBe("^19.2.0");
	expect(manifest.peerDependenciesMeta?.react).toEqual({ optional: true });
	expect(source).toContain(
		"useSyncExternalStore(resource.subscribe, resource.getSnapshot)",
	);
	expect(source).not.toMatch(
		/react-dom|tanstack|opentelemetry|createContext|fetch\(|retry|fallback/u,
	);
});

test("Team Support Desk observes ticket comments through one detail resource", () => {
	const browserRoot = resolve(import.meta.dir, "../../web");
	const sources = [
		readFileSync(resolve(browserRoot, "app.tsx"), "utf8"),
		readFileSync(resolve(browserRoot, "questpie.ts"), "utf8"),
		readFileSync(resolve(browserRoot, "tickets/detail.tsx"), "utf8"),
		readFileSync(resolve(browserRoot, "tickets/selected.tsx"), "utf8"),
	].join("\n");

	expect(sources).toContain('from "questpie/react"');
	expect(sources).toContain('["tickets.queue"].observe(');
	expect(sources).toContain('["tickets.detail"].observe(');
	expect(sources).toContain('["labels.page"].observe(');
	expect(sources).not.toMatch(
		/comments\.page|commentsSnapshot|CommentPage|commentPagePlan|queueRequest|detailRequest|filterSnapshot|pageSnapshot|refreshCurrentQueue|loadQueue|selectTicket|\.watch\(/u,
	);
});
