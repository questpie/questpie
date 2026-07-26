import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { createSimpleI18n } from "../../src/exports/client";
import {
	I18nProvider,
	useI18n,
	useTranslation,
} from "../../src/exports/client-react";

const originalGlobals = {
	document: globalThis.document,
	isReactActEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT,
	navigator: globalThis.navigator,
	window: globalThis.window,
};

describe("generic client i18n React bindings", () => {
	let dom: JSDOM;
	let root: Root | undefined;

	beforeEach(() => {
		dom = new JSDOM('<div id="root"></div>');
		Object.defineProperties(globalThis, {
			document: { configurable: true, value: dom.window.document },
			navigator: { configurable: true, value: dom.window.navigator },
			window: { configurable: true, value: dom.window },
		});
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	});

	afterEach(async () => {
		if (root) {
			await act(async () => root?.unmount());
			root = undefined;
		}
		dom.window.close();
		Object.defineProperties(globalThis, {
			document: { configurable: true, value: originalGlobals.document },
			IS_REACT_ACT_ENVIRONMENT: {
				configurable: true,
				value: originalGlobals.isReactActEnvironment,
				writable: true,
			},
			navigator: { configurable: true, value: originalGlobals.navigator },
			window: { configurable: true, value: originalGlobals.window },
		});
	});

	it("rerenders on locale changes and unsubscribes on unmount", async () => {
		const i18n = createSimpleI18n({
			locale: "en",
			locales: ["en", "sk"] as const,
			messages: {
				en: { greeting: "Hello" },
				sk: { greeting: "Ahoj" },
			},
		});
		const subscribe = i18n.onLocaleChange.bind(i18n);
		let activeSubscriptions = 0;
		i18n.onLocaleChange = (callback) => {
			activeSubscriptions++;
			const unsubscribe = subscribe(callback);
			return () => {
				activeSubscriptions--;
				unsubscribe();
			};
		};

		function CurrentTranslation() {
			const adapter = useI18n();
			const { t } = useTranslation();
			return <span>{`${adapter.locale}:${t("greeting")}`}</span>;
		}

		root = createRoot(dom.window.document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<I18nProvider adapter={i18n}>
					<CurrentTranslation />
				</I18nProvider>,
			);
		});
		expect(dom.window.document.body.textContent).toContain("en:Hello");
		expect(activeSubscriptions).toBe(1);

		await act(async () => i18n.setLocale("sk"));
		expect(dom.window.document.body.textContent).toContain("sk:Ahoj");

		await act(async () => root?.unmount());
		root = undefined;
		expect(activeSubscriptions).toBe(0);
	});

	it("renders with a deterministic server snapshot without browser globals", () => {
		const i18n = createSimpleI18n({
			locale: "en",
			locales: ["en"] as const,
			messages: { en: { greeting: "Hello" } },
		});

		function ServerTranslation() {
			const { t } = useTranslation();
			return <span>{t("greeting")}</span>;
		}

		const browserGlobals = {
			document: globalThis.document,
			window: globalThis.window,
		};
		Object.defineProperties(globalThis, {
			document: { configurable: true, value: undefined },
			window: { configurable: true, value: undefined },
		});
		try {
			expect(
				renderToString(
					<I18nProvider adapter={i18n}>
						<ServerTranslation />
					</I18nProvider>,
				),
			).toBe("<span>Hello</span>");
		} finally {
			Object.defineProperties(globalThis, {
				document: { configurable: true, value: browserGlobals.document },
				window: { configurable: true, value: browserGlobals.window },
			});
		}
	});
});
