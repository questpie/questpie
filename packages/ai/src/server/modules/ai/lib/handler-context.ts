import type {
	CollectionAPI,
	JobHandlerArgs,
	JsonRouteHandlerArgs,
	RawRouteHandlerArgs,
	ServiceInstanceOf,
} from "questpie";

import type { AiCollections, AiServices } from "../.generated/module.js";

export type AiCollectionsAPI = {
	[K in keyof AiCollections]: CollectionAPI<AiCollections[K], AiCollections>;
};

export type AiServicesAPI = {
	[K in keyof AiServices]: ServiceInstanceOf<AiServices[K]>;
};

type RealtimeSubscribe = (
	callback: () => void,
	options: {
		resourceType: string;
		resource: string;
		where?: Record<string, unknown>;
	},
) => () => void;

export type AiJobHandlerArgs<TPayload = unknown> = JobHandlerArgs<TPayload> & {
	collections: AiCollectionsAPI;
	services: AiServicesAPI;
};

export type AiJsonRouteContext<TInput = unknown> = JsonRouteHandlerArgs<TInput> & {
	collections: AiCollectionsAPI;
	services: AiServicesAPI;
};

export type AiRawRouteContext = RawRouteHandlerArgs & {
	collections: AiCollectionsAPI;
	realtime: { subscribe: RealtimeSubscribe };
};

/** Narrow module job/route context to AI collection APIs (runtime always provides these). */
export function asAiJobArgs<TPayload>(
	ctx: JobHandlerArgs<TPayload>,
): AiJobHandlerArgs<TPayload> {
	return ctx as AiJobHandlerArgs<TPayload>;
}

export function asAiJsonRoute<TInput>(
	ctx: JsonRouteHandlerArgs<TInput>,
): AiJsonRouteContext<TInput> {
	return ctx as AiJsonRouteContext<TInput>;
}

export function asAiRawRoute(ctx: RawRouteHandlerArgs): AiRawRouteContext {
	return ctx as AiRawRouteContext;
}
