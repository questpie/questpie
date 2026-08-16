# Acceptance protocol v2 proof

This isolated P22R1 proof removes the single-provider availability lock without
weakening a valid review verdict. It is an interstitial repository-quality
change tracked by #317 and blocks BETA-07 #294 until merge.

The proof preserves every protocol v1 artifact. It exercises one primary
Opus-medium disposition and, only after `NO_RESULT`, a packet-bound pair of
fresh GPT-5.6-sol medium Spec and Standards reviews. A committed v2 record is
accepted only when the deterministic verifier reconstructs the exact packet
from the reviewed commit.

## Required evidence

1. secret, dirty-tree, ancestry, manifest, authority-path/digest, and empty-diff
   gates remain fail closed;
2. primary PASS/BLOCKED is final and primary NO_RESULT is the only contingency
   transition;
3. two axes use distinct request and invocation identities over one digest;
4. tool events, unknown events, malformed shapes, mismatched bindings,
   transport failure, timeout, and missing axes produce no result;
5. unanimous PASS and mixed BLOCKED aggregation are exact;
6. the pinned Codex transport runs in separate empty read-only workspaces with
   ignored user config/rules and a structured response schema;
7. the committed record verifies byte-for-byte from its reviewed ancestor;
8. package, router, architecture, full/release, and diff gates remain green.

The candidate review is a maintainer-authorized bootstrap under ADR-0024. The
two GPT axes are still adversarial evidence; the explicit bootstrap authority,
not a circular self-claim, permits the prospective transition.
