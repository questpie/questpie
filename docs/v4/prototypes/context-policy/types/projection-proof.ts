import type {
	ContextInputOf,
	ContextResolvedOf,
	PolicyTargetOf,
} from "questpie";

import { appContext, messagePolicy } from "./application";
import type {
	AppContextInput,
	AppResolvedContext,
	MessagePolicyIdentity,
} from "./generated/app";

type Equal<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends <
		Value,
	>() => Value extends Right ? 1 : 2
		? true
		: false;
type Assert<Value extends true> = Value;

type ContextInputMatches = Assert<
	Equal<ContextInputOf<typeof appContext>, AppContextInput>
>;
type ContextResolvedMatches = Assert<
	Equal<ContextResolvedOf<typeof appContext>, AppResolvedContext>
>;
type PolicyTargetMatches = Assert<
	Equal<
		PolicyTargetOf<typeof messagePolicy>,
		PolicyTargetOf<MessagePolicyIdentity>
	>
>;

export type GeneratedProjectionProof = {
	readonly contextInput: ContextInputMatches;
	readonly contextResolved: ContextResolvedMatches;
	readonly policyTarget: PolicyTargetMatches;
};
