const scenarioName = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function parseScenarioFilter(
	args: readonly string[],
): string | undefined {
	const values: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] !== "--scenario") continue;
		const value = args[index + 1];
		if (!value || value.startsWith("--")) {
			throw new Error("--scenario requires a value");
		}
		values.push(value);
		index += 1;
	}
	if (values.length > 1) {
		throw new Error("--scenario may be provided only once");
	}
	const value = values[0];
	if (value && !scenarioName.test(value)) {
		throw new Error(`invalid --scenario value "${value}"`);
	}
	return value;
}

export function selectScenarioIds(
	registeredIds: readonly string[],
	requested: string | undefined,
): string[] {
	if (!requested) return [...registeredIds];
	const selected = registeredIds.filter(
		(id) => id === requested || id.startsWith(`${requested}-`),
	);
	if (selected.length === 0) {
		throw new Error(`unknown scenario "${requested}"`);
	}
	return selected;
}
