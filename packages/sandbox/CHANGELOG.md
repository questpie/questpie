# @questpie/sandbox

## 3.25.1

### Patch Changes

- Updated dependencies [[`6542080`](https://github.com/questpie/questpie/commit/65420804940ede8b419bfeed8964d5f1ce32b82b)]:
  - questpie@3.25.1
  - @questpie/mcp@3.25.1

## 3.25.0

### Patch Changes

- Updated dependencies [[`da70c88`](https://github.com/questpie/questpie/commit/da70c88286f0b5228d500b989554908d8724a463)]:
  - questpie@3.25.0
  - @questpie/mcp@3.25.0

## 3.24.0

### Patch Changes

- Updated dependencies [[`e23ad85`](https://github.com/questpie/questpie/commit/e23ad853d9c62b3e575d8cb9420ed63fe8924270), [`e23ad85`](https://github.com/questpie/questpie/commit/e23ad853d9c62b3e575d8cb9420ed63fe8924270)]:
  - questpie@3.24.0
  - @questpie/mcp@3.24.0

## 3.23.0

### Patch Changes

- Updated dependencies [[`bec0c23`](https://github.com/questpie/questpie/commit/bec0c23a78f1318a86c09e8d02f1584c89605c50), [`76bf85c`](https://github.com/questpie/questpie/commit/76bf85c681bf3187338574d8a9b4e21e47ac9051)]:
  - questpie@3.23.0
  - @questpie/mcp@3.23.0

## 3.22.0

### Patch Changes

- Updated dependencies [[`b5b4a81`](https://github.com/questpie/questpie/commit/b5b4a81f2864d0e17f960b3e1e52c727d45b7124), [`195648d`](https://github.com/questpie/questpie/commit/195648dba74395dfa1d37c6ba9382c40ef63c8e3), [`17b6cab`](https://github.com/questpie/questpie/commit/17b6cabffb8f340270c4caf4f8da36be42310fb7), [`cd62bb8`](https://github.com/questpie/questpie/commit/cd62bb8bf4df98b3f75c4a894ba8148677a3b9ae)]:
  - questpie@3.22.0
  - @questpie/mcp@3.22.0

## 3.21.1

### Patch Changes

- Updated dependencies [[`5c5f5b6`](https://github.com/questpie/questpie/commit/5c5f5b672acfeca55cf7ffd6db97dec535997bfe)]:
  - questpie@3.21.1
  - @questpie/mcp@3.21.1

## 3.21.0

### Patch Changes

- Updated dependencies [[`fb6653a`](https://github.com/questpie/questpie/commit/fb6653a8b41d5c7e61bf4fa209b2ec86cf91ec7b)]:
  - questpie@3.21.0
  - @questpie/mcp@3.21.0

## 3.20.1

### Patch Changes

- Updated dependencies [[`4e4ea31`](https://github.com/questpie/questpie/commit/4e4ea3174bce830b1a8efa95faf381aa36b88b24)]:
  - questpie@3.20.1
  - @questpie/mcp@3.20.1

## 3.20.0

### Patch Changes

- Updated dependencies [[`030c5dd`](https://github.com/questpie/questpie/commit/030c5dd09be7798fcb696e4e47312c758e855930)]:
  - questpie@3.20.0
  - @questpie/mcp@3.20.0

## 3.19.2

### Patch Changes

- Updated dependencies [[`8114e59`](https://github.com/questpie/questpie/commit/8114e5966ffce9ecc2dd1c3be844dfff065b8af3)]:
  - questpie@3.19.2
  - @questpie/mcp@3.19.2

## 3.19.1

### Patch Changes

- Updated dependencies [[`15a9f47`](https://github.com/questpie/questpie/commit/15a9f4726fdd68402532f3d6683b657e02a65863)]:
  - questpie@3.19.1
  - @questpie/mcp@3.19.1

## 3.19.0

### Patch Changes

- Updated dependencies [[`7510720`](https://github.com/questpie/questpie/commit/7510720b88e1688998f5bfe5e098f7a7b3313b38)]:
  - questpie@3.19.0
  - @questpie/mcp@3.19.0

## 3.18.0

### Patch Changes

- Updated dependencies [[`62992aa`](https://github.com/questpie/questpie/commit/62992aa22f0708cc0bf545231f1e6f9f47b58516)]:
  - questpie@3.18.0
  - @questpie/mcp@3.18.0

## 3.17.0

### Minor Changes

- [#186](https://github.com/questpie/questpie/pull/186) [`d6931de`](https://github.com/questpie/questpie/commit/d6931defd2705525091dd0cace56c516a8f9d5c3) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fail-closed remote workload authority across sandbox and MCP.
  - **sandbox**: add a generic, consumer-authorized workload admission path with
    signed single-use transport binding, strict resource limits, canonical broker
    routing, safe audit events, and no product-specific principal model. Sandboxed
    guests can list and invoke an explicitly bound subset of application MCP custom
    tools through opaque, revocable, bounded host sessions; guests never receive
    the application, database, authorizer, or native broker token.
  - **mcp**: require explicit catalog entries for every CRUD operation, route,
    resource, and custom tool; derive OAuth scopes from that same catalog and
    re-authorize discovery and invocation through scopes, RBAC, and an opaque
    workload authorizer. Apply shared input/output, depth, node, deadline,
    cancellation, catalog-size, global-concurrency, and per-principal-concurrency
    bounds across HTTP, stdio, resources, and direct workload tool calls while
    keeping public errors disclosure-safe.
  - Retire the unsupported `@questpie/ai` workspace runtime and its
    worker/fleet/Harness/provider application model. Historical npm versions remain
    available, but QUESTPIE does not publish a compatibility stub.
  - Remove ambient stdio system authority and the private executor spike; sandbox
    execution remains available through QUESTPIE's core executor service.

### Patch Changes

- Updated dependencies [[`f534369`](https://github.com/questpie/questpie/commit/f53436930137368000294877b5f02ced55b2dbf4), [`4be1529`](https://github.com/questpie/questpie/commit/4be15299ffafa8a4808474823815a3dc6d49689d), [`079be69`](https://github.com/questpie/questpie/commit/079be6971f1ff3b8f6aed4a1c8bc0b3182bfcb99), [`b5c2b78`](https://github.com/questpie/questpie/commit/b5c2b78f274d444a0b63867d262025d2ebd592a9), [`d6931de`](https://github.com/questpie/questpie/commit/d6931defd2705525091dd0cace56c516a8f9d5c3), [`d752314`](https://github.com/questpie/questpie/commit/d75231406e016b0e07f36182fc6dc9dbb1f8b224), [`c1ab1c0`](https://github.com/questpie/questpie/commit/c1ab1c0b8873a66a163effbc31ec431a5d442298), [`1a750e0`](https://github.com/questpie/questpie/commit/1a750e02a7c9eea7a52c035b009b78b79742961c), [`158ff0c`](https://github.com/questpie/questpie/commit/158ff0c58933a4b498191d99544222af134bea49), [`875ae8c`](https://github.com/questpie/questpie/commit/875ae8c23fbdebd7e557a86ce4ee19c8c180d9aa), [`5c4804a`](https://github.com/questpie/questpie/commit/5c4804a8f45a34e3b8f20fc1210c2518f18e6f6a)]:
  - questpie@3.17.0
  - @questpie/mcp@3.17.0

## 3.16.0

### Patch Changes

- Updated dependencies [[`ea5f109`](https://github.com/questpie/questpie/commit/ea5f1096009fec7818b0ffd6ae74412662a3ac6e)]:
  - questpie@3.16.0

## 3.15.2

### Patch Changes

- Updated dependencies [[`734737f`](https://github.com/questpie/questpie/commit/734737fd5a079c4063b6ff49f34fbacf01d8a2e8)]:
  - questpie@3.15.2

## 3.15.1

### Patch Changes

- Updated dependencies [[`1e2691f`](https://github.com/questpie/questpie/commit/1e2691f6d2f310860bf81db2219f23dd4d122d10)]:
  - questpie@3.15.1

## 3.15.0

### Patch Changes

- Updated dependencies [[`3e2dc5e`](https://github.com/questpie/questpie/commit/3e2dc5ed47b0b6fa279586d3ce3d27a2cc3154fb), [`0fd1da3`](https://github.com/questpie/questpie/commit/0fd1da363e432653b8c45cef02ed867d3bf34d47), [`018dfb5`](https://github.com/questpie/questpie/commit/018dfb5b77039d0148a59d371062d08d1b89b691)]:
  - questpie@3.15.0

## 3.1.0

### Minor Changes

- [#125](https://github.com/questpie/questpie/pull/125) [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Make the AI, MCP, and sandbox packages publishable with release metadata, README documentation, package typecheck fixes, and stable sandbox adapter tests.

### Patch Changes

- Updated dependencies [[`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92)]:
  - questpie@3.14.0

## 3.0.13

### Patch Changes

- Updated dependencies [[`9423a47`](https://github.com/questpie/questpie/commit/9423a47da757508935f192f73cc99b3ea7bac575), [`9423a47`](https://github.com/questpie/questpie/commit/9423a47da757508935f192f73cc99b3ea7bac575)]:
  - questpie@3.13.0

## 3.0.12

### Patch Changes

- Updated dependencies [[`2f6e776`](https://github.com/questpie/questpie/commit/2f6e776896a9381514a237447d4dcc85dad558d0)]:
  - questpie@3.12.0

## 3.0.11

### Patch Changes

- Updated dependencies [[`4ed62ec`](https://github.com/questpie/questpie/commit/4ed62ec7375e7f841a20e7c36c11e15bc4f63b39), [`fed686a`](https://github.com/questpie/questpie/commit/fed686a4a37a34a80783538c632e0597a4a98ec8), [`7c4060d`](https://github.com/questpie/questpie/commit/7c4060df2fbc663cc9d4e718cff4ce72cdd83663), [`6cddd5b`](https://github.com/questpie/questpie/commit/6cddd5b2ec2127db40aa6b97212254689b9f780f)]:
  - questpie@3.11.0

## 3.0.10

### Patch Changes

- Updated dependencies [[`d673da7`](https://github.com/questpie/questpie/commit/d673da7c463233222c8605851c9957cd2e90027d)]:
  - questpie@3.10.0

## 3.0.9

### Patch Changes

- Updated dependencies [[`9e14122`](https://github.com/questpie/questpie/commit/9e1412231f18b40db2c87c1ce35dc352842b5cff)]:
  - questpie@3.9.1

## 3.0.8

### Patch Changes

- Updated dependencies [[`835f985`](https://github.com/questpie/questpie/commit/835f98502bd98a2c2b3f34201ac6370f03105c93)]:
  - questpie@3.9.0

## 3.0.7

### Patch Changes

- Updated dependencies [[`590e6c4`](https://github.com/questpie/questpie/commit/590e6c433a73a44316e89d00eeeaa21b0d584e3b), [`a56e017`](https://github.com/questpie/questpie/commit/a56e0179f6016915996e9bd9a58c7279d070692a), [`81e4922`](https://github.com/questpie/questpie/commit/81e4922e7ed54a2ff2171e86a9ce45a07b7c433b), [`b15ce41`](https://github.com/questpie/questpie/commit/b15ce41ce2ed8378abd0ea3e42c8f577abe9ad6b)]:
  - questpie@3.8.0

## 3.0.6

### Patch Changes

- Updated dependencies [[`029f036`](https://github.com/questpie/questpie/commit/029f036053039e73f9a97d1fe4785ef8c05771f4)]:
  - questpie@3.7.0

## 3.0.5

### Patch Changes

- Updated dependencies [[`c8c4a84`](https://github.com/questpie/questpie/commit/c8c4a845b4f7442ff92123391b2636a9f15d9727)]:
  - questpie@3.6.1

## 3.0.4

### Patch Changes

- Updated dependencies [[`13aad6f`](https://github.com/questpie/questpie/commit/13aad6f57cfd8a6678b7c34d3e33ea324f954a81)]:
  - questpie@3.6.0

## 3.0.3

### Patch Changes

- Updated dependencies [[`ea701dd`](https://github.com/questpie/questpie/commit/ea701ddaa32f85056bbbcb7ba77099af349d6480)]:
  - questpie@3.5.6

## 3.0.2

### Patch Changes

- Updated dependencies [[`24c0f0e`](https://github.com/questpie/questpie/commit/24c0f0edcc22dd21da3070139e96cb9bab7601e0)]:
  - questpie@3.5.5

## 3.0.1

### Patch Changes

- Updated dependencies [[`4591b08`](https://github.com/questpie/questpie/commit/4591b08ff5f06196ea9303df2a5b0b08f9134c54)]:
  - questpie@3.5.4
