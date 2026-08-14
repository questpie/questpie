# QUESTPIE v4 beta.1 implementation issue map

- Parent: [#261](https://github.com/questpie/questpie/issues/261)
- Build authority: [`beta1-build-spec.md`](./beta1-build-spec.md)
- Machine contract:
  [`implementation-collapse-p16/QUEUE.json`](./prototypes/implementation-collapse-p16/QUEUE.json)
- Accepted evidence: `2c4d2c1100ff72a463a6110d7e458a4e76221f2e`

| Queue ID | GitHub issue                                            | Native blocked by | Initial label state                 |
| -------- | ------------------------------------------------------- | ----------------- | ----------------------------------- |
| BETA-01  | [#288](https://github.com/questpie/questpie/issues/288) | none              | `wayfinder:task`, `ready-for-agent` |
| BETA-02  | [#289](https://github.com/questpie/questpie/issues/289) | #288              | `wayfinder:task`                    |
| BETA-03  | [#290](https://github.com/questpie/questpie/issues/290) | #289              | `wayfinder:task`                    |
| BETA-04  | [#291](https://github.com/questpie/questpie/issues/291) | #290              | `wayfinder:task`                    |
| BETA-05  | [#292](https://github.com/questpie/questpie/issues/292) | #291              | `wayfinder:task`                    |
| BETA-06  | [#293](https://github.com/questpie/questpie/issues/293) | #292              | `wayfinder:task`                    |
| BETA-07  | [#294](https://github.com/questpie/questpie/issues/294) | #293              | `wayfinder:task`                    |
| BETA-08  | [#295](https://github.com/questpie/questpie/issues/295) | #294              | `wayfinder:task`                    |
| BETA-09  | [#296](https://github.com/questpie/questpie/issues/296) | #295              | `wayfinder:task`                    |
| BETA-10  | [#297](https://github.com/questpie/questpie/issues/297) | #296              | `wayfinder:task`                    |
| BETA-11  | [#298](https://github.com/questpie/questpie/issues/298) | #297              | `wayfinder:task`                    |
| BETA-12  | [#299](https://github.com/questpie/questpie/issues/299) | #298              | `wayfinder:task`                    |

Every row is a native sub-issue of #261. A successor becomes agent-ready only
after GitHub reports every native dependency closed and its accepted issue
contract still matches repository authority. Existing #262–#283 remain
historical component backlog, not this execution queue.

The exact first issue to run is #288.
