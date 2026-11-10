# MCP catalog budgets and discovery at scale

Checked: **2026-10-23**. Independent Codex research. Facts below distinguish inspected primary sources, coordinator evidence, and design recommendations. Research only; no runtime or release change is authorized by this note.

## Finding: 100 KB is an AP compatibility budget

**Inspected fact:** QUESTPIE currently requires serialized catalogs to be **strictly below 100,000 UTF-8 bytes**; `maxCatalogBytes` can only tighten this. It measures `JSON.stringify(ListToolsResult)` after projection/schema conversion, including result metadata but excluding the JSON-RPC envelope, and rejects pagination. The check also reaches workload discovery and the tool port. This is framework policy, not evidence of an MCP protocol limit. See [budget implementation](../../../packages/mcp/src/server/catalog-byte-budget.ts), [server projection](../../../packages/mcp/src/server/create-server.ts), [workload boundary](../../../packages/mcp/src/server/workload-boundary.ts), and [tool port](../../../packages/mcp/src/server/workload-tool-port.ts).

**AP evidence:** [Human OAuth HTTP test](/home/drepkovsky/code/autopilot/apps/operator-web/tests/scenario-harness/human-mcp-oauth-http.test.ts:3582) measures **`JSON.stringify(result.tools)`**, one unpaginated full-scope OAuth catalog, and asserts `< 100_000`. Its comments record claude.ai/Desktop connection failures around **116,619 B**, board item `1a2c3360-86bf-449d-b625-39401db15d4a`, and the owner's **2026-09-25** ceiling decision. The [webhook decision](/home/drepkovsky/code/autopilot/docs/decisions/2026-10-12-webhook-mcp-catalog-budget.md) records an unpublished seven-tool catalog at 103,316 B and consolidation into two descriptors under the existing budget.

**Provenance limitation:** the coordinator confirms no exact affected client version, error string, or official host documentation accompanies that evidence. AP comments also alternate between a 100,000-_token_ discovery limit and an approximate _byte_ limit. These units are not interchangeable. Treat this as an **empirical AP operational compatibility budget**, with an inherited host-limit claim, rather than a verified universal threshold. QUESTPIE's wrapper-inclusive measurement is slightly more conservative and is a different measurement object.

The official [Claude connector guide](https://claude.com/docs/connectors/building#design-within-the-size-and-timeout-limits) documents tool-result and timeout limits, not a 100 KB catalog ceiling. I found no official confirmation of that ceiling in the host documentation checked. Tool-result limits cannot establish discovery limits.

**Separate inspected AP gate:** the [same test](/home/drepkovsky/code/autopilot/apps/operator-web/tests/scenario-harness/human-mcp-oauth-http.test.ts:3586) asserts each serialized `inputSchema` is **strictly below 16,384 B**, citing reported connect-time silent dropping and upstream issue #77296. Preserve this app compatibility check independently; the comment is operational evidence, not a protocol-wide guarantee or an independently verified issue report.

## Three stages; three different constraints

1. **Host ingestion:** the connector obtains descriptors over MCP. Limits may concern each response, an aggregated catalog, tool count, or individual schemas.
2. **Model-context injection:** the host chooses which ingested definitions the model sees. Deferring these saves context without necessarily reducing ingestion.
3. **Execution:** the selected registered operation validates real arguments and re-establishes current authority before dispatch.

**Inference:** optimizing stage 2 does not prove stage 1 can accept a larger catalog. A search/execute gateway changes the advertised surface itself, but shifts responsibility for discovery quality, validation, approvals, and output handling into the gateway.

## What current primary sources actually support

**MCP listing:** [tools/list](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) supports pagination. `tools.listChanged` announces notifications; the current revision sends them to clients subscribed through `subscriptions/listen` with `toolsListChanged: true`. These mechanisms do not specify a 100 KB ceiling or guarantee lazy model loading. [Pagination](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination) uses server-sized pages and opaque cursors; clients can traverse all pages. **Inference:** a host may still aggregate the entire catalog, so smaller pages alone do not establish compatibility.

**Version matters:** [2026-07-28 versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning) uses per-request version/capability metadata and explicit unsupported-version errors; [2025-11-25 lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) uses initialization negotiation. Do not assume current SDKs or affected clients implement the latest revision or every optional feature.

**Dynamic state:** the current tools specification forbids lists varying by connection or as a side effect of another request; it permits variation by request authorization. For older session-based designs, any enabled-tool state must remain isolated to that caller/session, never shared globally across users. For the current revision, prefer stable endpoint projections and request-authorized visibility, with host-local discovery state. `list_changed` is not permission to mutate a shared multi-user catalog after one user's search.

**Anthropic API tool search:** [advanced tool use](https://www.anthropic.com/research/advanced-tool-use) explicitly supplies all definitions to the API while marking deferred tools with `defer_loading: true`; search returns references expanded into definitions for model context. MCP toolsets can likewise be deferred. Built-in regex and BM25 search show that a vector database is not a prerequisite. **Inference:** this is context management, not proof that a remote connector avoids full catalog ingestion or any host ceiling.

**Claude Code:** its [current MCP guide](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search) documents on-demand discovery enabled by default on supported configurations, with model/deployment fallbacks. `ENABLE_TOOL_SEARCH=auto` uses a 10% context threshold; that threshold mode is not the current universal default. This is host-specific support, not evidence about the affected claude.ai/Desktop connector versions or a byte-limit bypass.

**Cloudflare:** [Code Mode](https://blog.cloudflare.com/code-mode-mcp/) advertises two tools, `search` and `execute`, over an API with more than 2,500 endpoints. It searches the OpenAPI specification and executes JavaScript server-side, with OAuth downscoping to user-approved permissions. This demonstrates a small advertised interface over a large operation space. Its approximately 1,000-token claim is not a measured AP catalog size or proof of compatibility with AP's affected clients. Borrow progressive discovery, not arbitrary code execution.

**GitHub:** [current configuration](https://github.com/github/github-mcp-server/blob/main/docs/server-configuration.md) offers selected toolsets/tools, exclusions, and scope filtering. Its old dynamic `enable_toolset` discovery was local-only and [removed in May 2026](https://github.com/github/github-mcp-server/pull/2512). Do not present it as a current remote-host capability or an uncomplicated pattern to copy.

## Recommended KISS direction — future design, not this minor

Keep **one route registry and one shared executor**. Attach budgets to an **endpoint/release/host projection**, not the product's entire operation universe. Preserve explicit fail-closed admission (AUTH-10); do not silently drop tools or relax the accepted minor's checks.

Here, stable means deterministic for the same release, host projection and effective request authorization, including granted OAuth scopes and other discovery policy. It does not mean a single list for all clients. The coordinator reports that AP already uses `customToolAllows` to filter Human MCP discovery by granted scopes, with a partial-scope client seeing about 17 fewer tools. Preserve that authorization-based variation; it is distinct from enabling more tools as a side effect of a search request. This count is supplied coordination evidence, not a measurement rerun here.

- **Compatibility connector:** an explicit, curated product surface with tested host budgets and useful domain operations. AP retains its coordinator target **≤85 KB** and the separate `<16,384 B` input-schema gate pending a new design.
- **Native host tool search:** expose the complete authorized released catalog where the actual host supports it, still subject to measured transport, aggregate-catalog, individual-schema, and resource bounds. Context deferral alone does not justify lifting a host-ingestion budget.
- **Optional large-domain gateway:** bounded `search`, exact `describe`, and `execute` over that same registry. Keep AP domain operations separate from bridged-service namespaces; derive any search index from existing registrations and bridge identities, not a second hand-maintained catalog. Start with names, namespaces, and lexical matching; add semantic infrastructure only after demonstrated retrieval failures.

Discovery metadata must use existing eligibility, permission keys, and scopes (Q85/AUTH-11), excluding hidden operations and metadata. Search is neither an authorization cache nor a grant of authority. Execute resolves an **exact registered identity**, validates the **original operation schema**, and freshly checks actor, scopes, and workload capability. Apply the target product ACL **once, with real input, at the shared executor**, rather than probing it using invented search arguments. Preserve approvals, audit, idempotency, revocation behavior, and indistinguishable denied/nonexistent responses (AUTH-9). No arbitrary JavaScript, raw SQL, duplicate handlers, or hidden-but-callable bypass surface.

**Tradeoff:** generic execution loses some native per-tool input typing, operation-specific annotations, approval controls, and output-schema precision. A host may offer “always allow execute” across many operations. Exact describe results and internal schema validation help, but do not restore native host guarantees. Keep operation-specific server approvals and return an explicit result envelope; one generic output schema cannot transparently preserve every original output contract. Direct typed tools remain useful for frequent and sensitive operations.

## Coordinator follow-up and release boundary

Record affected client/surface/version, date, raw error or silent-drop observation, OAuth scopes, and whether the host bounds one page, the aggregate tools array, the whole result, or individual schemas. Require empirical proof on current claude.ai/Desktop before treating pagination or `list_changed` as a compatibility solution.

Coordinator reports AP main **#319 merged, 84,230 B**, names consolidated; **#317/#318 pending**. Those are supplied coordination facts, not measurements or PR checks rerun here. Preserve merge-only coordination, never rebase, and notify file ownership before any future AP rewrite. This investigation blocks neither the API minor/WHOL work nor the TanStack fix.

**Stop claiming:** “MCP universally requires catalogs below 100 KB”; “all hosts/carriers need this ceiling”; “tool search or pagination bypasses it”; or “16 KB input schemas are an MCP standard.” Say instead: **AP currently enforces empirical connector compatibility budgets; scalable discovery needs separately verified host projections and the same authorization/execution path.**
