declare const questpieObservabilityBrand: unique symbol;

/**
 * Opaque host configuration accepted only from an official QUESTPIE
 * observability adapter. Application code cannot structurally implement it.
 */
export interface QuestpieObservability {
	readonly [questpieObservabilityBrand]: true;
}
