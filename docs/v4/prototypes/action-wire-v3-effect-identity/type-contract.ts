import type {
	ActionCallerOptions,
	ActionHandlerFacts,
	EffectScope,
} from "./contract";

const caller: ActionCallerOptions = { effectKey: "stable-provider-material" };
void caller.effectKey;

// @ts-expect-error callers provide stable material, never the final Effect Identity
const callerEffectId: ActionCallerOptions = { effectId: "forged" };
void callerEffectId;

// @ts-expect-error Mutation callId is not an Effect Identity alias
const mutationAlias: ActionCallerOptions = { callId: "mutation-receipt-only" };
void mutationAlias;

// @ts-expect-error idempotencyKey overclaims provider semantics and is not the contract
const misleadingAlias: ActionCallerOptions = { idempotencyKey: "forged" };
void misleadingAlias;

declare const facts: ActionHandlerFacts;
facts.effect.id;
// @ts-expect-error handlers cannot recover caller material
facts.effect.effectKey;

const scope: EffectScope = {
	application: "application:collaboration",
	tenant: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	principal: { kind: "user", id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4" },
	action: "action:delivery.publish",
	effectKey: "stable",
};
void scope;

// @ts-expect-error owner identities are already canonical; bare names are forbidden
const bareApplication: EffectScope = { ...scope, application: "collaboration" };
void bareApplication;

// @ts-expect-error owner identities are already canonical; no internal prefixing
const bareAction: EffectScope = { ...scope, action: "delivery.publish" };
void bareAction;
