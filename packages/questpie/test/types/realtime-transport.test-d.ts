import type {
	ChangeBroker,
	ChangeWake,
	ClientSink,
	ClientTransport,
	LocalSessionClientTransport,
	SharedProviderClientTransport,
} from "../../src/exports/realtime.js";
import type { Equal, Expect } from "./type-test-utils.js";

type _brokerIsIndependentFromEdgeDelivery = Expect<
	Equal<Extract<keyof ChangeBroker, keyof ClientTransport>, "start" | "stop">
>;

type _localTransportCannotPublishSharedChannels = Expect<
	Equal<
		"publishChannel" extends keyof LocalSessionClientTransport ? true : false,
		false
	>
>;

type _sharedTransportCanPublishSharedChannels = Expect<
	Equal<
		"publishChannel" extends keyof SharedProviderClientTransport ? true : false,
		true
	>
>;

type _sharedUserAuthenticationRemainsAnOptionalCapability = Expect<
	Equal<
		{} extends Pick<SharedProviderClientTransport, "generateUserAuth">
			? true
			: false,
		true
	>
>;

declare const sink: ClientSink;
declare const wake: ChangeWake;

sink.write(new Uint8Array(), "latest-snapshot");
sink.write(new Uint8Array(), "ordered-channel-event");
void wake.kind;
