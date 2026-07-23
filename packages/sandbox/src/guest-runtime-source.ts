const GUEST_BINDINGS_IMPORT =
	'import { buildGuestBindings } from "./guest-bindings.ts";';

/** Inline the trusted dependency so the guest entry needs no host path/socket. */
export function bundleGuestRuntimeSource(
	guestEntrySource: string,
	guestBindingsSource: string,
): string {
	if (!guestEntrySource.includes(GUEST_BINDINGS_IMPORT)) {
		throw new Error(
			"Guest entry does not contain the qualified bindings import.",
		);
	}
	const inlinedBindings = guestBindingsSource.replace(/^export /gm, "");
	return `${inlinedBindings}\n${guestEntrySource.replace(GUEST_BINDINGS_IMPORT, "")}`;
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
