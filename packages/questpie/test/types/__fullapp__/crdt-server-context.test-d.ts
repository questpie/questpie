declare const context: Questpie.AppContext;

context.crdt.withAuthorityMutation([], async () => {});

// The full-app fixture has no collaborative owners. The generated request API
// must therefore expose an exact empty registry, never CrdtServerAPI<any>.
// @ts-expect-error ordinary collections are not CRDT document owners
void context.crdt.collections.articles;

// @ts-expect-error phantom collection keys must stay absent
void context.crdt.collections.phantom;
