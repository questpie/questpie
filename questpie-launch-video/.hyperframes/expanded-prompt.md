# QUESTPIE Product Launch Video Production Breakdown

## Style Block

Duration: 30 seconds at 1920x1080, 30fps.

Updated brand direction: align the launch film with the QUESTPIE admin UI and `apps/docs` landing page rather than a hard brutalist interpretation. The baseline is a dark neutral product workspace with flat surfaces, compact controls, restrained motion, and rounded surface/control geometry. Use Geist for headings, labels, and product copy; use JetBrains Mono only for code, metadata, URLs, and compact technical labels. Accent color is exactly `#B700FF`, reserved for brand marks, scanner/cursor moments, and rare emphasis instead of every active state.

Base palette follows the admin/docs tokens: `#121212` background, `#ECECEC` foreground, `#A0A0A0` muted text, `#737373` subtle text, `#161616` surface, `#1B1B1B` cards, `#2A2A2A` elevated active surfaces, `#262626` subtle borders, `#343434` default borders, `#4A4A4A` strong borders, and `#B700FF` brand accent.

Negative prompt: no glow, no persistent shadows, no glossy 3D, no startup-neon, no magical particles, no vague AI abstraction, no decorative color beyond neutral surfaces and the one brand accent.

## Rhythm Declaration

Pattern: `hook-build-PEAK-proof-CTA`.

The video starts with a direct typographic thesis, compresses scattered plumbing into a single contract, expands that contract into typed runtime surfaces, confirms breadth through a capability grid, then proves the premise with a generated-product placeholder before locking to the QUESTPIE mark.

Transitions: primary transition is a mechanical shutter wipe using the same neutral surface tokens as the app. Accent transition is a grid-cover compression when the contract projects into surfaces. No jump cuts; each scene enters with system-like snap motion and transitions handle scene exits.

## Scene 1: HeroPlumbing, 0-3s

Concept: A developer starts surrounded by scattered implementation fragments: routes, schemas, jobs, auth, clients, OpenAPI, permissions. The fragments collapse into one central product-system frame, establishing the message: build the product, not the plumbing.

Depth layers: BG includes a hairline grid, coordinate labels, and scattered plumbing labels. MG is the two-line thesis. FG is a central system frame and registration marks.

Animation choreography: Labels snap inward on axis-aligned paths. The thesis stamps in with horizontal compression. The central frame draws itself with scale transforms. Neutral active surfaces mark convergence, with `#B700FF` kept to small brand/accent signals.

Transition out: mechanical shutter bands, 0.34s, `power3.inOut`.

## Scene 2: PlatformContract, 3-7s

Concept: The chaos becomes a formal platform contract. A central block titled Platform Contract presents rows for schema, routes, jobs, workflows, admin config, and access rules; an accent scanner line locks each row.

Depth layers: BG contains static grid columns and a faint manifest label. MG is the contract table. FG contains row lock indicators, scanner line, and a small deterministic status rail.

Animation choreography: The block slides in from the left edge. Rows cascade with alternating x and scale entrances. The scanner line steps down row by row in `#B700FF`. Lock indicators switch from passive border to active accent.

Transition out: grid-cover compression, 0.42s, `power4.inOut`.

## Scene 3: RuntimeProjection, 7-13s

Concept: The single contract becomes typed runtime surfaces. Three connected panels form a product diagram: APIs & Clients, Admin UI, and Runtime. Lines and ports show that they are projections from one source, not separate rebuilds.

Depth layers: BG includes diagram rails, measurement ticks, and title metadata. MG includes the contract node and three output panels. FG includes port nodes, connection lines, and active accent markers.

Animation choreography: Contract anchors first. Connector rails draw outward. Panels snap into a three-column layout. Individual rows type in and settle. Accent ports pulse once, then hold.

Transition out: mechanical shutter bands, 0.34s, `power3.inOut`.

## Scene 4: CapabilitiesGrid, 13-19s

Concept: The product surface gets breadth without getting messy. Built-in capabilities appear as a strict grid; one active card at a time receives a neutral strong border and elevated surface, with a small `#B700FF` data accent.

Depth layers: BG is a dense ruled canvas with status labels. MG is the 8-card capability grid. FG includes the two-line claim and active-card telemetry.

Animation choreography: Headline locks first. Grid cells assemble in a deterministic row-major sequence. Active state moves from card to card with a hard neutral border swap, elevated card fill, and small accent bar. No card glows.

Transition out: vertical shutter cover, 0.36s, `power3.inOut`.

## Scene 5: ProductProof, 19-24s

Concept: A short product-proof placeholder shows the backend model producing the visible product surfaces. A code/schema panel transforms into admin/API/docs panels inside a framed footage placeholder.

Depth layers: BG contains static timeline marks and product-proof labels. MG is the large footage frame with code on the left and generated surfaces on the right. FG has a stamped caption: Generated from your backend model.

Animation choreography: Placeholder frame clips in from the bottom. Code rows type in. Three output panels snap to the right. An accent path travels once from code to surfaces. The "No duplicate wiring" and "No scattered definitions" lines stamp in above the frame.

Transition out: slow black color dip via solid overlay, 0.52s, `sine.inOut`.

## Scene 6: FinalLockup, 24-30s

Concept: The system resolves to the brand. QUESTPIE appears as a precise terminal-like lockup with the thesis under it and questpie.com below.

Depth layers: BG is sparse: only a grid baseline, frame corners, and small release metadata. MG is the QUESTPIE wordmark. FG is the tagline, URL, and a final active block cursor.

Animation choreography: Frame corners draw in first. QUESTPIE stamps in. Tagline follows with a horizontal reveal. URL types in, then holds. The final active cursor blinks a finite number of times and the whole lockup fades to black only at the end.

Transition out: final fade only, 0.45s.

## Recurring Motifs

Axis-aligned motion, strict grid columns, tabular numbers, compact metadata labels, rounded QUESTPIE admin/docs surfaces, sparse `#B700FF` brand accent, mechanical shutter transitions, central contract as source of truth, and visible borders instead of depth effects.
