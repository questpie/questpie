import { appConfig } from "#questpie/server/config/factories.js";
import type { InferContextExtensionsFromAppConfig } from "#questpie/server/config/context.js";

import type { Equal, Expect, HasKey } from "./type-test-utils.js";

const config = appConfig({
	context: async ({ request }) => ({
		organizationId: request.headers.get("x-org"),
		hasOrganizationHeader: request.headers.has("x-org"),
	}),
});

type ContextExtensions = InferContextExtensionsFromAppConfig<typeof config>;

type _hasOrganizationId = Expect<
	Equal<HasKey<ContextExtensions, "organizationId">, true>
>;
type _organizationIdType = Expect<
	Equal<ContextExtensions["organizationId"], string | null>
>;
type _hasBooleanFlag = Expect<
	Equal<ContextExtensions["hasOrganizationHeader"], boolean>
>;
