export function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0)
		return error.message.replaceAll("_", " ").toLowerCase();
	return "the request could not be completed";
}

export function dateTime(value: Date): string {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(value);
}
