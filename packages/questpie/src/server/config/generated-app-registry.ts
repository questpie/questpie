const GENERATED_APP_REGISTRY = Symbol.for("questpie.generated-app-registry.v1");

type DestroyableApp = Readonly<{
	destroy(): void | Promise<void>;
}>;

type GeneratedAppEntry<TApp extends DestroyableApp> = {
	readonly promise: Promise<TApp>;
	leases: number;
	shutdownPromise?: Promise<void>;
};

type GeneratedAppRegistry = Map<string, GeneratedAppEntry<DestroyableApp>>;

export type GeneratedAppLease<TApp extends DestroyableApp> = Readonly<{
	promise: Promise<TApp>;
	release(): Promise<void>;
	shutdown(): Promise<void>;
}>;

/**
 * Acquire one process-local generated app identity.
 *
 * The generated identity comes from the package name plus the app's source
 * root, not from its public URL. Duplicate server chunks therefore share one
 * app while separate apps are free to use the same URL.
 *
 * @internal Used by generated QUESTPIE app entrypoints.
 */
export function acquireGeneratedApp<TApp extends DestroyableApp>(
	identity: string,
	create: () => TApp | Promise<TApp>,
): GeneratedAppLease<TApp> {
	if (identity.length === 0) {
		throw new Error("Generated QUESTPIE app identity cannot be empty");
	}
	const registry = generatedAppRegistry();
	let entry = registry.get(identity) as GeneratedAppEntry<TApp> | undefined;
	if (!entry) {
		const promise = Promise.resolve().then(create);
		entry = { promise, leases: 0 };
		registry.set(identity, entry as GeneratedAppEntry<DestroyableApp>);
		void promise.catch(() => {
			if (registry.get(identity) === entry) registry.delete(identity);
		});
	}
	entry.leases++;

	let active = true;
	return Object.freeze({
		promise: entry.promise,
		async release() {
			if (!active) return;
			active = false;
			entry!.leases--;
			if (entry!.shutdownPromise) return;
			if (entry!.leases !== 0 || registry.get(identity) !== entry) return;
			await shutdownGeneratedAppEntry(registry, identity, entry!);
		},
		shutdown() {
			active = false;
			return shutdownGeneratedAppEntry(registry, identity, entry!);
		},
	});
}

function shutdownGeneratedAppEntry<TApp extends DestroyableApp>(
	registry: GeneratedAppRegistry,
	identity: string,
	entry: GeneratedAppEntry<TApp>,
): Promise<void> {
	return (entry.shutdownPromise ??= (async () => {
		if (registry.get(identity) === entry) registry.delete(identity);
		const app = await entry.promise;
		await app.destroy();
	})());
}

function generatedAppRegistry(): GeneratedAppRegistry {
	const target = globalThis as typeof globalThis & {
		[GENERATED_APP_REGISTRY]?: GeneratedAppRegistry;
	};
	return (target[GENERATED_APP_REGISTRY] ??= new Map());
}
