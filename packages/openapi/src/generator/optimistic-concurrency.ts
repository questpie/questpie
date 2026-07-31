export function ifMatchParameter() {
	return {
		name: "If-Match",
		in: "header",
		required: false,
		schema: { type: "string", pattern: '^"[0-9]+"$' },
		description:
			"Quoted canonical revision. Equivalent to expectedRevision in the JSON body.",
	};
}

export function withRevisionEtag(
	responses: Record<string, unknown>,
	enabled: boolean,
) {
	if (!enabled) return responses;
	const success = responses["200"] as Record<string, unknown> | undefined;
	if (!success) return responses;
	return {
		...responses,
		"200": {
			...success,
			headers: {
				ETag: {
					description: "Quoted canonical revision of the returned resource",
					schema: { type: "string", pattern: '^"[0-9]+"$' },
				},
			},
		},
	};
}
