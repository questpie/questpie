import { useEffect, useRef } from "react";

/**
 * QUESTPIE Brand Visual Assets — Animated variants
 * Ported 1:1 from brand visual-assets.jsx (v2.0)
 *
 * All animations: CSS-only, long durations (6–48s), low opacity range,
 * smooth ease-in-out, no stagger. prefers-reduced-motion respected.
 *
 * Derived from the Q symbol quarter-circle geometry.
 */

const P = "#B700FF";
const W = "currentColor";

/* ════════════════════════════════════════════
   ANIMATED SVGs
   ════════════════════════════════════════════ */

/**
 * Hero background — concentric quarter-arcs from bottom-right.
 * Arcs breathe gently, dots pulse, pie piece fades.
 * Usage: Hero section background, always-on.
 */
export function AnimHeroArcs({ className }: { className?: string }) {
	const arcRadii = [480, 380, 280, 180, 100];
	// Origin at bottom-right corner of viewBox (500, 500)
	// Arcs sweep left and up from origin
	const ox = 500;
	const oy = 500;
	const arcPaths = arcRadii.map(
		(r) => `M ${ox - r} ${oy} A ${r} ${r} 0 0 1 ${ox} ${oy - r}`,
	);

	return (
		<svg
			viewBox="0 0 500 500"
			fill="none"
			className={className}
			aria-hidden="true"
		>
			{/* Static arc strokes with breathing opacity */}
			{arcRadii.map((r, i) => (
				<path
					key={`arc-${r}`}
					d={arcPaths[i]}
					stroke={P}
					strokeWidth={i === 2 ? 2 : 1}
					className={`_brand-ha _brand-ha-${i}`}
				/>
			))}

			{/* Pie piece — bottom-right origin */}
			<path
				d={`M ${ox} ${oy} L ${ox} ${oy - 160} A 160 160 0 0 0 ${ox - 160} ${oy} Z`}
				fill={P}
				className="_brand-ha-pie"
			/>

			{/* Travelling highlight pulses along each arc */}
			{arcRadii.map((r, i) => (
				<g key={`pulse-${r}`}>
					<circle r={i === 2 ? 3.5 : 2.5} fill={P} opacity={0.15}>
						<animateMotion
							dur={`${12 + i * 4}s`}
							repeatCount="indefinite"
							path={arcPaths[i]}
						/>
					</circle>
					{i % 2 === 0 && (
						<circle r={1.5} fill={P} opacity={0.1}>
							<animateMotion
								dur={`${14 + i * 3}s`}
								repeatCount="indefinite"
								begin={`${3 + i}s`}
								path={arcPaths[i]}
							/>
						</circle>
					)}
				</g>
			))}

			{/* Orbiting dots — each rides an arc path */}
			{(
				[
					{ arc: 0, dur: 16, r: 2.5 },
					{ arc: 1, dur: 20, r: 2 },
					{ arc: 2, dur: 14, r: 3 },
					{ arc: 3, dur: 18, r: 2 },
					{ arc: 4, dur: 12, r: 1.5 },
				] as const
			).map((dot) => (
				<circle
					key={`orbit-dot-${dot.arc}`}
					r={dot.r}
					fill={P}
					className={`_brand-ha-dot _brand-ha-dot-${dot.arc}`}
				>
					<animateMotion
						dur={`${dot.dur}s`}
						repeatCount="indefinite"
						path={arcPaths[dot.arc]}
						keyPoints="0;1;0"
						keyTimes="0;0.5;1"
						calcMode="spline"
						keySplines="0.42 0 0.58 1;0.42 0 0.58 1"
					/>
				</circle>
			))}

			{/* Stationary accent dots near bottom-right */}
			{(
				[
					[400, 390],
					[450, 440],
					[360, 320],
					[480, 460],
					[320, 280],
					[440, 360],
				] as const
			).map(([x, y], i) => (
				<circle
					key={`static-dot-${x}-${y}`}
					cx={x}
					cy={y}
					r={2}
					fill={P}
					className={`_brand-ha-dot _brand-ha-dot-${i}`}
				/>
			))}
		</svg>
	);
}

/**
 * Section divider — flowing arc line with travelling dots.
 * Two dots ride the curve at different speeds. Dash segment follows.
 * Usage: Between sections, always-on.
 */
export function AnimArcDivider({ className }: { className?: string }) {
	const curve = "M 0 60 Q 300 60 400 40 T 600 40 T 800 50 T 1000 30 T 1200 40";
	return (
		<svg
			viewBox="0 0 1200 80"
			fill="none"
			className={className}
			aria-hidden="true"
		>
			<path d={curve} stroke={P} strokeWidth={1} opacity={0.2} />
			<path
				d={curve}
				stroke={P}
				strokeWidth={1.5}
				strokeDasharray="70 2330"
				className="_brand-ad-dash"
			/>
			<circle r="3" fill={P} opacity={0.35}>
				<animateMotion dur="10s" repeatCount="indefinite" path={curve} />
			</circle>
			<circle r="2" fill={P} opacity={0.25}>
				<animateMotion
					dur="10s"
					repeatCount="indefinite"
					begin="4s"
					path={curve}
				/>
			</circle>
		</svg>
	);
}

/**
 * Module grid — quarter-circle pieces in cells. Cells breathe independently.
 * Usage: Features / modularity section ambient.
 */
export function AnimModuleGrid({ className }: { className?: string }) {
	const cells = [
		{ x: 0, y: 0, t: "filled" },
		{ x: 1, y: 0, t: "arc" },
		{ x: 2, y: 0, t: "empty" },
		{ x: 3, y: 0, t: "dot" },
		{ x: 0, y: 1, t: "arc-r" },
		{ x: 1, y: 1, t: "filled" },
		{ x: 2, y: 1, t: "dot" },
		{ x: 3, y: 1, t: "arc" },
		{ x: 0, y: 2, t: "dot" },
		{ x: 1, y: 2, t: "empty" },
		{ x: 2, y: 2, t: "arc-r" },
		{ x: 3, y: 2, t: "filled" },
	] as const;
	const s = 64;
	const g = 6;
	return (
		<svg
			viewBox={`0 0 ${4 * (s + g)} ${3 * (s + g)}`}
			fill="none"
			className={className}
			aria-hidden="true"
		>
			{cells.map((c) => {
				const ox = c.x * (s + g);
				const oy = c.y * (s + g);
				const dur = 6 + c.x * 1.3 + c.y * 0.9;
				return (
					<g key={`cell-${c.x}-${c.y}`}>
						<rect
							x={ox}
							y={oy}
							width={s}
							height={s}
							stroke="currentColor"
							strokeWidth={1}
							opacity={0.08}
						/>
						{c.t === "filled" && (
							<path
								d={`M ${ox} ${oy + s} L ${ox} ${oy} A ${s} ${s} 0 0 1 ${ox + s} ${oy + s} Z`}
								fill={P}
								style={{
									animation: `_brand-gf ${dur}s ease-in-out infinite`,
								}}
							/>
						)}
						{c.t === "arc" && (
							<path
								d={`M ${ox + s} ${oy} A ${s} ${s} 0 0 1 ${ox} ${oy + s}`}
								stroke={P}
								strokeWidth={1.5}
								style={{
									animation: `_brand-gs ${dur}s ease-in-out infinite`,
								}}
							/>
						)}
						{c.t === "arc-r" && (
							<path
								d={`M ${ox} ${oy} A ${s} ${s} 0 0 1 ${ox + s} ${oy + s}`}
								stroke={P}
								strokeWidth={1.5}
								style={{
									animation: `_brand-gs ${dur}s ease-in-out infinite`,
								}}
							/>
						)}
						{c.t === "dot" && (
							<circle
								cx={ox + s / 2}
								cy={oy + s / 2}
								r={4}
								fill={P}
								style={{
									animation: `_brand-gf ${dur}s ease-in-out infinite`,
								}}
							/>
						)}
					</g>
				);
			})}
		</svg>
	);
}

/**
 * Orbit arcs — framework adapters on concentric orbits.
 * Dots orbit dynamically at different speeds, with a highlighted arc connecting them.
 * Usage: Ecosystem / compatibility section, always-on.
 */
export function AnimOrbitArcs({ className }: { className?: string }) {
	const containerRef = useRef<SVGSVGElement>(null);

	const cx = 200;
	const cy = 200;

	// Orbit data with nodes moving at different speeds
	const orbitsData = [
		{
			r: 100,
			nodes: [
				{ label: "Hono", speed: 10, startAngle: 0 },
				{ label: "Elysia", speed: 18, startAngle: 180 },
			],
		},
		{
			r: 160,
			nodes: [
				{ label: "Next.js", speed: -8, startAngle: 90 },
				{ label: "TanStack", speed: -14, startAngle: 270 },
			],
		},
	];

	useEffect(() => {
		let rafId: number;
		const startTime = performance.now();

		function render(time: number) {
			const elapsed = (time - startTime) / 1000;
			const svg = containerRef.current;
			if (!svg) return;

			// Pulse center core
			const core = svg.querySelector("#core-pulse");
			if (core) {
				const corePulse = Math.sin(elapsed * 2) * 0.5 + 0.5;
				// Base scale is 1 (the paths are already scaled down inside).
				// We just scale this group up to 1.15.
				core.setAttribute(
					"transform",
					`scale(${(1 + corePulse * 0.15).toFixed(4)})`,
				);
				core.setAttribute("opacity", (0.8 + corePulse * 0.2).toFixed(2));
			}

			orbitsData.forEach((orbit, oIdx) => {
				const n1 = orbit.nodes[0];
				const n2 = orbit.nodes[1];

				const a1 = (n1.startAngle + n1.speed * elapsed) % 360;
				const a2 = (n2.startAngle + n2.speed * elapsed) % 360;

				const rad1 = (a1 * Math.PI) / 180;
				const x1 = cx + orbit.r * Math.cos(rad1);
				const y1 = cy + orbit.r * Math.sin(rad1);

				const rad2 = (a2 * Math.PI) / 180;
				const x2 = cx + orbit.r * Math.cos(rad2);
				const y2 = cy + orbit.r * Math.sin(rad2);

				// Update node 1
				const g1 = svg.querySelector(`#node-${oIdx}-0`);
				if (g1) {
					g1.setAttribute(
						"transform",
						`translate(${x1.toFixed(2)}, ${y1.toFixed(2)})`,
					);
					const halo = g1.querySelector(".node-halo");
					if (halo) {
						const pulse = Math.sin(elapsed * 3 + oIdx) * 0.5 + 0.5;
						halo.setAttribute("r", (5 + pulse * 1.5).toFixed(2));
						halo.setAttribute("opacity", (0.4 + pulse * 0.3).toFixed(2));
					}
				}

				// Update node 2
				const g2 = svg.querySelector(`#node-${oIdx}-1`);
				if (g2) {
					g2.setAttribute(
						"transform",
						`translate(${x2.toFixed(2)}, ${y2.toFixed(2)})`,
					);
					const halo = g2.querySelector(".node-halo");
					if (halo) {
						const pulse = Math.sin(elapsed * 3 + oIdx + 1) * 0.5 + 0.5;
						halo.setAttribute("r", (5 + pulse * 1.5).toFixed(2));
						halo.setAttribute("opacity", (0.4 + pulse * 0.3).toFixed(2));
					}
				}

				// Update connector path & pulse its opacity slightly
				const conn = svg.querySelector(`#conn-${oIdx}`);
				if (conn) {
					const diff = (((a2 - a1) % 360) + 360) % 360;
					const sweepFlag = diff <= 180 ? 1 : 0;

					const baseOpacity = oIdx === 0 ? 0.35 : 0.25;
					const pulse = Math.sin(elapsed * 1.5 + oIdx) * 0.5 + 0.5;
					conn.setAttribute("opacity", (baseOpacity + pulse * 0.15).toFixed(2));

					if (Math.abs(x1 - x2) < 0.1 && Math.abs(y1 - y2) < 0.1) {
						conn.setAttribute("d", "");
					} else {
						conn.setAttribute(
							"d",
							`M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${orbit.r} ${orbit.r} 0 0 ${sweepFlag} ${x2.toFixed(2)} ${y2.toFixed(2)}`,
						);
					}
				}
			});

			rafId = requestAnimationFrame(render);
		}

		rafId = requestAnimationFrame(render);
		return () => cancelAnimationFrame(rafId);
	}, []);

	return (
		<svg
			ref={containerRef}
			viewBox="0 0 400 400"
			fill="none"
			className={className}
			aria-hidden="true"
		>
			{/* Center core — QUESTPIE Symbol */}
			<g transform={`translate(${cx}, ${cy})`} opacity={0.8}>
				{/* The pulsing wrapper */}
				<g id="core-pulse">
					{/* Inner glow/halo behind it */}
					<circle r="15" fill={P} opacity={0.15} />
					<circle r="25" fill={P} opacity={0.05} />

					{/* The logo paths, shifted to center 0,0 and scaled down by 0.04 directly in the group */}
					<g transform="scale(0.04) translate(-320, -320)">
						{/* Outer Ring */}
						<path
							d="M466.377 350.987C468.486 340.983 469.595 330.611 469.595 319.98C469.595 237.377 402.624 170.406 320.001 170.406C237.378 170.406 170.406 237.377 170.406 319.98C170.406 393.857 223.976 455.23 294.402 467.372V510.268C200.465 497.754 128 417.329 128 319.98C128 213.952 213.962 128 320.001 128C426.04 128 512.002 213.952 512.002 319.98C512.002 344.198 507.517 367.37 499.332 388.708C489.817 374.897 478.748 362.239 466.377 350.987ZM320.002 469.553C381.932 469.553 435.067 431.927 457.799 378.296C468.772 389.602 478.366 402.254 486.309 415.98C453.11 473.357 391.065 511.959 320.002 511.959L320.002 469.553Z"
							fill={W}
						/>
						{/* Purple Pie */}
						<path
							d="M320.002 512H512.004V511.985C512.004 405.958 426.042 320.005 320.003 320.005C320.003 320.005 320.002 320.005 320.002 320.005V512Z"
							fill={P}
						/>
					</g>
				</g>
			</g>

			{/* Orbit rings */}
			{orbitsData.map((orbit) => (
				<circle
					key={`orbit-${orbit.r}`}
					cx={cx}
					cy={cy}
					r={orbit.r}
					stroke={W}
					strokeWidth={0.5}
					opacity={0.08}
				/>
			))}

			{/* Connectors */}
			{orbitsData.map((orbit, oIdx) => {
				const n1 = orbit.nodes[0];
				const n2 = orbit.nodes[1];
				const a1 = n1.startAngle;
				const a2 = n2.startAngle;
				const diff = (((a2 - a1) % 360) + 360) % 360;
				const sweepFlag = diff <= 180 ? 1 : 0;

				const rad1 = (a1 * Math.PI) / 180;
				const x1 = cx + orbit.r * Math.cos(rad1);
				const y1 = cy + orbit.r * Math.sin(rad1);

				const rad2 = (a2 * Math.PI) / 180;
				const x2 = cx + orbit.r * Math.cos(rad2);
				const y2 = cy + orbit.r * Math.sin(rad2);

				const d = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${orbit.r} ${orbit.r} 0 0 ${sweepFlag} ${x2.toFixed(2)} ${y2.toFixed(2)}`;

				return (
					<path
						key={`conn-init-${oIdx}`}
						id={`conn-${oIdx}`}
						d={d}
						stroke={P}
						strokeWidth={oIdx === 0 ? 2 : 1.5}
						opacity={oIdx === 0 ? 0.35 : 0.25}
						fill="none"
						strokeLinecap="round"
					/>
				);
			})}

			{/* Nodes */}
			{orbitsData.map((orbit, oIdx) =>
				orbit.nodes.map((node, nIdx) => {
					const rad = (node.startAngle * Math.PI) / 180;
					const x = cx + orbit.r * Math.cos(rad);
					const y = cy + orbit.r * Math.sin(rad);

					return (
						<g
							key={node.label}
							id={`node-${oIdx}-${nIdx}`}
							transform={`translate(${x.toFixed(2)}, ${y.toFixed(2)})`}
						>
							{/* Pulsing halo */}
							<circle
								className="node-halo"
								r={5}
								fill="var(--background, #0a0a0a)"
								stroke={P}
								strokeWidth={1.5}
								opacity={0.4}
							/>
							{/* Inner dot */}
							<circle r={2} fill={P} opacity={0.6} />
							{/* Label */}
							<text
								y={-10}
								textAnchor="middle"
								fill={W}
								opacity={0.35}
								style={{
									fontFamily: "'JetBrains Mono Variable', monospace",
									fontSize: 10,
									fontWeight: 500,
								}}
							>
								{node.label}
							</text>
						</g>
					);
				}),
			)}
		</svg>
	);
}

/**
 * Architecture layers — stacked quarter-circles, size = scope.
 * Each layer breathes independently at its own slow pace.
 * Usage: Architecture / composability section ambient.
 */
export function AnimLayerStack({ className }: { className?: string }) {
	const layers = [
		{ label: "Core", sub: "q()", size: 220 },
		{ label: "Adapters", sub: ".build()", size: 170 },
		{ label: "Modules", sub: ".use()", size: 120 },
		{ label: "Client", sub: "qa()", size: 70 },
	];
	const ox = 60;
	return (
		<svg
			viewBox="0 0 520 420"
			fill="none"
			className={className}
			aria-hidden="true"
		>
			{layers.map((l, i) => {
				const cy = 370 - i * 65;
				return (
					<g key={l.label}>
						{/* Quarter-circle fill */}
						<path
							d={`M ${ox} ${cy} L ${ox} ${cy - l.size} A ${l.size} ${l.size} 0 0 1 ${ox + l.size} ${cy} Z`}
							fill={P}
							style={{
								animation: `_brand-lb ${7 + i * 1.5}s ease-in-out infinite`,
							}}
						/>
						{/* Arc stroke outline for depth */}
						<path
							d={`M ${ox} ${cy - l.size} A ${l.size} ${l.size} 0 0 1 ${ox + l.size} ${cy}`}
							stroke={P}
							strokeWidth={0.5}
							opacity={0.15}
							fill="none"
						/>
						{/* Connector line to label */}
						<line
							x1={ox + l.size + 4}
							y1={cy - l.size / 2}
							x2={ox + l.size + 14}
							y2={cy - l.size / 2}
							stroke={P}
							strokeWidth={0.5}
							opacity={0.15}
						/>
						<text
							x={ox + l.size + 20}
							y={cy - l.size / 2 + 4}
							fill={W}
							opacity={0.5}
							style={{
								fontFamily: "'JetBrains Mono Variable', monospace",
								fontSize: 13,
								fontWeight: 600,
							}}
						>
							{l.label}
						</text>
						<text
							x={ox + l.size + 20}
							y={cy - l.size / 2 + 20}
							fill={W}
							opacity={0.22}
							style={{
								fontFamily: "'JetBrains Mono Variable', monospace",
								fontSize: 11,
							}}
						>
							{l.sub}
						</text>
					</g>
				);
			})}
			{/* Base line for grounding */}
			<line
				x1={ox}
				y1={370}
				x2={ox + 220}
				y2={370}
				stroke={P}
				strokeWidth={0.5}
				opacity={0.1}
			/>
		</svg>
	);
}

/**
 * Schema flow — one input → multiple outputs via arc connectors.
 * Tiny dots travel along paths. Schema box breathes.
 * Usage: "Define once, ship everywhere" section, always-on.
 */
export function AnimSchemaFlow({ className }: { className?: string }) {
	const outs = [
		{ l: "REST", y: 30 },
		{ l: "RPC", y: 70 },
		{ l: "Realtime", y: 110 },
		{ l: "Admin UI", y: 150 },
		{ l: "Typed Client", y: 190 },
	];
	return (
		<svg
			viewBox="0 0 600 220"
			fill="none"
			className={className}
			aria-hidden="true"
		>
			<rect
				x="20"
				y="70"
				width="100"
				height="60"
				stroke={P}
				strokeWidth={1}
				fill={P}
				fillOpacity={0.04}
				className="_brand-sb"
			/>
			<text
				x="70"
				y="95"
				textAnchor="middle"
				fill={W}
				opacity={0.5}
				style={{
					fontFamily: "'JetBrains Mono', monospace",
					fontSize: 11,
					fontWeight: 600,
				}}
			>
				Schema
			</text>
			<text
				x="70"
				y="112"
				textAnchor="middle"
				fill={W}
				opacity={0.2}
				style={{
					fontFamily: "'JetBrains Mono', monospace",
					fontSize: 9,
				}}
			>
				q().collection()
			</text>
			{outs.map((o, i) => {
				const p = `M 120 100 L 200 100 Q 240 100 240 ${o.y < 100 ? o.y + 40 : o.y - 40} L 240 ${o.y} L 420 ${o.y}`;
				return (
					<g key={o.l}>
						<path
							d={p}
							stroke={P}
							strokeWidth={0.5}
							opacity={0.05}
							fill="none"
						/>
						<circle r="1.5" fill={P} opacity={0.1}>
							<animateMotion
								dur={`${6 + i}s`}
								repeatCount="indefinite"
								begin={`${i * 0.8}s`}
								path={p}
							/>
						</circle>
						<circle cx={420} cy={o.y} r={2} fill={P} opacity={0.1} />
						<text
							x={432}
							y={o.y + 4}
							fill={W}
							opacity={0.3}
							style={{
								fontFamily: "'JetBrains Mono', monospace",
								fontSize: 10,
							}}
						>
							{o.l}
						</text>
					</g>
				);
			})}
		</svg>
	);
}

/**
 * Floating pie pieces — ambient quarter-circles at various sizes/rotations.
 * Pieces fade between 0.02–0.07 opacity. Barely perceptible.
 * Usage: Parallax background layer.
 */
export function AnimFloatingPies({ className }: { className?: string }) {
	const ps = [
		{ x: 60, y: 50, s: 40, r: 0 },
		{ x: 200, y: 120, s: 24, r: 90 },
		{ x: 340, y: 30, s: 56, r: 180 },
		{ x: 480, y: 100, s: 32, r: 270 },
		{ x: 140, y: 160, s: 18, r: 45 },
		{ x: 400, y: 170, s: 44, r: 135 },
		{ x: 550, y: 60, s: 28, r: 315 },
	];
	return (
		<svg
			viewBox="0 0 600 200"
			fill="none"
			className={className}
			aria-hidden="true"
		>
			{ps.map((p, i) => (
				<path
					key={`pie-${p.x}-${p.y}`}
					d={`M ${p.x} ${p.y} L ${p.x} ${p.y - p.s} A ${p.s} ${p.s} 0 0 1 ${p.x + p.s} ${p.y} Z`}
					fill={P}
					transform={`rotate(${p.r}, ${p.x}, ${p.y})`}
					style={{
						animation: `_brand-pf ${9 + i * 2}s ease-in-out infinite`,
					}}
				/>
			))}
		</svg>
	);
}

/**
 * Dot grid — structured dot pattern with purple highlights.
 * Soft diagonal wave. Normal dots: 0.02–0.06. Accent dots: 0.04–0.18.
 * Usage: Hero / section background.
 */
export function AnimDotGrid({ className }: { className?: string }) {
	const dots: Array<{
		cx: number;
		cy: number;
		highlight: boolean;
		delay: number;
	}> = [];
	for (let x = 0; x < 20; x++) {
		for (let y = 0; y < 10; y++) {
			const highlight = (x + y) % 7 === 0;
			dots.push({
				cx: x * 30 + 15,
				cy: y * 30 + 15,
				highlight,
				delay: ((x + y) / 28) * 3.5,
			});
		}
	}
	return (
		<svg
			viewBox="0 0 600 300"
			fill="none"
			className={className}
			aria-hidden="true"
		>
			{dots.map((d) => (
				<circle
					key={`dg-${d.cx}-${d.cy}`}
					cx={d.cx}
					cy={d.cy}
					r={d.highlight ? 2 : 1}
					fill={d.highlight ? P : W}
					style={{
						animation: `${d.highlight ? "_brand-da" : "_brand-dn"} 6s ease-in-out infinite ${d.delay}s`,
					}}
				/>
			))}
		</svg>
	);
}

/**
 * Corner accents — small decorative elements for cards/boxes.
 */
export function CornerSquare({
	size = 48,
	className,
}: {
	size?: number;
	className?: string;
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 48 48"
			fill="none"
			className={className}
			aria-hidden="true"
		>
			<rect x="28" y="0" width="20" height="20" fill={P} opacity={0.15} />
			<rect x="36" y="0" width="12" height="12" fill={P} opacity={0.25} />
		</svg>
	);
}

export function CornerPie({
	size = 48,
	className,
}: {
	size?: number;
	className?: string;
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 48 48"
			fill="none"
			className={className}
			aria-hidden="true"
		>
			<path d="M 48 0 L 48 48 A 48 48 0 0 1 0 0 Z" fill={P} opacity={0.1} />
		</svg>
	);
}
