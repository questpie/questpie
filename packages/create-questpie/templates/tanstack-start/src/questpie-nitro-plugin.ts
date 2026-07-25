import { definePlugin } from "nitro";
import { createGracefulServerShutdown } from "questpie/app";

import { tracingSrvxPlugins } from "#nitro/virtual/tracing";
import { destroyApp } from "#questpie";

export default definePlugin((nitroApp) => {
	const lifecycle = createGracefulServerShutdown(destroyApp);
	tracingSrvxPlugins.push((server) => lifecycle.attach(server));
	const onSignal = () => {
		void lifecycle.shutdown().catch(() => {});
	};
	const signals = ["SIGINT", "SIGTERM"] as const;

	if (typeof process !== "undefined") {
		for (const signal of signals) process.once(signal, onSignal);
	}

	nitroApp.hooks.hook("close", async () => {
		if (typeof process !== "undefined") {
			for (const signal of signals) process.off(signal, onSignal);
		}
		await lifecycle.shutdown();
	});
});
