# @questpie/tanstack-db

Typed TanStack DB collections backed by a QUESTPIE client.

The primary server-rendering pattern is to create both the TanStack Query
`QueryClient` and the QUESTPIE collections once per request. A module-scope
collection registry is safe only in the browser because it also owns optimistic
state.

The package currently supports refetch and full-snapshot synchronization. Native
row-delta synchronization is added independently without changing the collection
factory API.
