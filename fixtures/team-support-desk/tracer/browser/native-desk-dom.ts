import { environmentManager } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { act } from "react";

export async function settleDeskUi(predicate: () => boolean) {
	const deadline = Date.now() + 2_000;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("Native Desk UI did not settle");
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
}

export function installNativeDeskDom() {
	const dom = new JSDOM('<div id="root"></div>', {
		url: "http://questpie.test",
	});
	const previous = new Map<string, PropertyDescriptor | undefined>();
	const wasServer = environmentManager.isServer();
	for (const [key, value] of Object.entries({
		window: dom.window,
		document: dom.window.document,
		navigator: dom.window.navigator,
		location: dom.window.location,
		FormData: dom.window.FormData,
		IS_REACT_ACT_ENVIRONMENT: true,
	})) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	environmentManager.setIsServer(() => false);
	dom.window.HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	dom.window.HTMLDialogElement.prototype.close = function () {
		this.open = false;
	};
	return () => {
		environmentManager.setIsServer(() => wasServer);
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
		dom.window.close();
	};
}
