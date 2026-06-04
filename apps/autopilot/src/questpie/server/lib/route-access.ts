import type { RouteAccessRule } from "questpie/services";
import type { RequestContext } from "questpie/types";

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

export const sessionOnly: RouteAccessRule = ({ session }) => {
	const auth = session as RequestContext["session"];
	return isNonEmptyString(auth?.user?.id);
};
