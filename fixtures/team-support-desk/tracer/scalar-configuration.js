const compatibilityHeaderNames = new Set([
	"Questpie-Application",
	"Questpie-Client-Contract",
	"Questpie-Wire-Digest",
]);

function parameterLists(document) {
	return Object.values(document.paths).flatMap((pathItem) =>
		Object.values(pathItem).flatMap((operation) =>
			Array.isArray(operation?.parameters) ? [operation.parameters] : [],
		),
	);
}

export function createScalarConfiguration(document) {
	const compatibilityHeaders = new Map();
	for (const parameters of parameterLists(document)) {
		for (const parameter of parameters) {
			if (!compatibilityHeaderNames.has(parameter.name)) continue;
			compatibilityHeaders.set(parameter.name, parameter.schema.default);
		}
	}
	if (compatibilityHeaders.size !== compatibilityHeaderNames.size)
		throw new TypeError(
			"generated OpenAPI compatibility carriers are incomplete",
		);

	const content = structuredClone(document);
	for (const parameters of parameterLists(content)) {
		parameters.splice(
			0,
			parameters.length,
			...parameters.filter(
				(parameter) => !compatibilityHeaderNames.has(parameter.name),
			),
		);
	}

	return {
		content,
		onBeforeRequest: ({ requestBuilder }) => {
			for (const [name, value] of compatibilityHeaders)
				requestBuilder.headers.set(name, value);
		},
	};
}
