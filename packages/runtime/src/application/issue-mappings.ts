import type {
	RuntimeDeclaredErrorContract,
	RuntimeIssueMappings,
} from "../operation";
import {
	failRuntimeArtifact as fail,
	runtimeArtifactRecord as record,
	runtimeArtifactString as string,
} from "./artifact-protocol";

function identity(
	value: unknown,
	label: string,
	prefix: "collection" | "issue",
): string {
	const result = string(value, label);
	if (!result.startsWith(`${prefix}:`) || result.length === prefix.length + 1)
		fail(`${label} is invalid`);
	return result;
}

export function decodeRuntimeIssueMappings(
	value: unknown,
	declaredErrors: readonly RuntimeDeclaredErrorContract[],
	label: string,
): RuntimeIssueMappings {
	return Object.freeze(
		Object.fromEntries(
			Object.entries(record(value, label))
				.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
				.map(([collection, rawIssues]) => [
					identity(collection, `${label} Collection identity`, "collection"),
					Object.freeze(
						Object.fromEntries(
							Object.entries(
								record(rawIssues, `${label} Collection issue mappings`),
							)
								.sort(([left], [right]) =>
									left < right ? -1 : left > right ? 1 : 0,
								)
								.map(([issue, target]) => {
									const issueIdentity = identity(
										issue,
										`${label} Issue identity`,
										"issue",
									);
									const issueName = issueIdentity.slice(
										`issue:${collection.slice("collection:".length)}/`.length,
									);
									if (
										!issueIdentity.startsWith(
											`issue:${collection.slice("collection:".length)}/`,
										) ||
										issueName.length === 0 ||
										issueName.includes("/")
									)
										fail(`${label} Issue does not belong to its Collection`);
									const targetKey = string(target, `${label} target`);
									if (
										!declaredErrors.some(
											(error) =>
												error.key === targetKey && error.payload === null,
										)
									)
										fail(`${label} target is invalid`);
									return [issueIdentity, targetKey];
								}),
						),
					),
				]),
		),
	);
}
