import type { GeneratedActions, GeneratedMutations } from "./generated-app";

declare const actions: GeneratedActions;
declare const mutations: GeneratedMutations;

actions./*ACTION_ROOT*/ delivery./*ACTION_MEMBER*/ sendMessage;
mutations./*MUTATION_ROOT*/ messages./*MUTATION_MEMBER*/ recordDelivery;
const hover = actions.delivery./*HOVER*/ sendMessage;
void hover;
