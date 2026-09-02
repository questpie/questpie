import { renderClientHttpResponse } from "./client-http-response";
import { renderClientPostHttp } from "./client-post-http";
import { renderClientQueryHttp } from "./client-query-http";

/** Renders the complete canonical HTTP transport for the generated client. */
export function renderClientHttp(
	input: Readonly<{
		application: string;
		clientContractDigest: string;
		httpContractDigest: string;
	}>,
): string {
	return `${renderClientHttpResponse()}${renderClientQueryHttp(input)}${renderClientPostHttp(input)}`;
}
