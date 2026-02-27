/**
 * Extract the state type from a QuestpieBuilder instance.
 * Used for lazy type extraction in extension methods.
 */
export type QuestpieStateOf<T> = T extends { state: infer S } ? S : never;
