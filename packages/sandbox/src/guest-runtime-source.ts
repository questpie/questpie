const GUEST_BINDINGS_IMPORT =
	'import { buildGuestBindings } from "./guest-bindings.ts";';
const HTTP_BODY_CAP_MARKER = "__QP_HTTP_FETCH_BODY_CAP_BYTES__";

/** Inline the trusted dependency so the guest entry needs no host path/socket. */
export function bundleGuestRuntimeSource(
	guestEntrySource: string,
	guestBindingsSource: string,
	httpBodyCapBytes: number,
): string {
	if (!guestEntrySource.includes(GUEST_BINDINGS_IMPORT)) {
		throw new Error(
			"Guest entry does not contain the qualified bindings import.",
		);
	}
	if (
		!guestEntrySource.includes(HTTP_BODY_CAP_MARKER) ||
		!Number.isSafeInteger(httpBodyCapBytes) ||
		httpBodyCapBytes <= 0
	) {
		throw new Error("Guest entry does not contain a valid HTTP body cap.");
	}
	const inlinedBindings = guestBindingsSource.replace(/^export /gm, "");
	return `${inlinedBindings}\n${guestEntrySource
		.replace(GUEST_BINDINGS_IMPORT, "")
		.replaceAll(HTTP_BODY_CAP_MARKER, String(httpBodyCapBytes))}`;
}

/** Build a local module URL that works inside an isolated network namespace. */
export function guestRuntimeDataUrl(source: string): string {
	const bytes = new TextEncoder().encode(source);
	let binary = "";
	const chunkSize = 0x8000;
	for (let index = 0; index < bytes.length; index += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
	}
	return `data:application/typescript;base64,${btoa(binary)}`;
}
