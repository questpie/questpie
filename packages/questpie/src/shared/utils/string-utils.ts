export function toCamelCase(str: string): string {
	return str
		.replace(/[-_\s]+(.)?/g, (_, char) => (char ? char.toUpperCase() : ""))
		.replace(/^(.)/, (char) => char.toLowerCase());
}
export function toPascalCase(str: string): string {
	return str
		.replace(/[-_\s]+(.)?/g, (_, char) => (char ? char.toUpperCase() : ""))
		.replace(/^(.)/, (char) => char.toUpperCase());
}

export function toKebabCase(str: string): string {
	return str
		.replace(/([a-z])([A-Z])/g, "$1-$2")
		.replace(/[\s_]+/g, "-")
		.toLowerCase();
}

export function toSnakeCase(str: string): string {
	return str
		.replace(/([a-z])([A-Z])/g, "$1_$2")
		.replace(/[\s-]+/g, "_")
		.toLowerCase();
}
