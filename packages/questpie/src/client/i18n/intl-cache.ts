const DEFAULT_MAX_ENTRIES = 32;

function optionsKey(options: object | undefined): string {
	if (!options) return "";
	return JSON.stringify(
		Object.entries(options)
			.filter(([, value]) => value !== undefined)
			.sort(([left], [right]) => left.localeCompare(right)),
	);
}

export class IntlFormatterCache<T> {
	readonly #entries = new Map<string, T>();
	readonly #maxEntries: number;

	constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
		this.#maxEntries = maxEntries;
	}

	get(locale: string, options: object | undefined, create: () => T): T {
		const key = `${locale}\0${optionsKey(options)}`;
		const existing = this.#entries.get(key);
		if (existing !== undefined) {
			this.#entries.delete(key);
			this.#entries.set(key, existing);
			return existing;
		}

		const value = create();
		this.#entries.set(key, value);
		if (this.#entries.size > this.#maxEntries) {
			const oldestKey = this.#entries.keys().next().value;
			if (oldestKey !== undefined) this.#entries.delete(oldestKey);
		}
		return value;
	}
}
