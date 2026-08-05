---
"questpie": patch
---

Fix channel subscriptions over SSE denying every rule that reads the app service
surface, and stop a rule that threw from reporting itself as a denial.

`ChannelOperationContext` is an `AppContext`, so an `authorize` or `presence`
rule may read `collections`, `globals`, `services`. Route handlers get that
surface folded in by `executeRoute` and collection access rules get it from
`executeAccessRule`, but the SSE endpoint (`POST /realtime`) handed the rule the
lean `RequestContext` that `app.createContext()` returns. `context.collections`
was `undefined`, the rule threw, and `POST /realtime` answered
`REALTIME_SUBSCRIPTION_REJECTED / "Channel subscription is denied"` — for an
actor who satisfied the rule. Collection realtime was unaffected, which is why
this looked like a channel-only access problem.

All three request-path construction sites now build the rule context through one
factory, `createChannelServiceContext`, which folds the service surface in.

The second half is why it took two investigations to find the first.
`evaluateRule` caught everything and returned `false`, so a `TypeError`, a typo,
a missing context field and a genuine denial were one indistinguishable outcome.
A rule that throws still fails closed, but it now logs at error level with the
cause and raises `channel_rule_failed`: the SSE frame says which channel's rule
failed instead of claiming a verdict, and the channel HTTP routes answer 500
rather than 403. A rule that times out still denies — no answer means no. The
rule's own message stays server-side.
