"use client";

import { useEffect, useRef, useState } from "react";

import { CodeSample } from "./code";
import type { CodeAnnotation } from "./code";

export type HeroCodeSnippet = {
	annotations?: readonly CodeAnnotation[];
	code: string;
	description: string;
	file: string;
	key: string;
	label: string;
	mark?: string;
};

export function HeroCodeRotator({
	items,
}: {
	items: readonly HeroCodeSnippet[];
}) {
	const rootRef = useRef<HTMLDivElement>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	const [animate, setAnimate] = useState(false);
	const [focusWithin, setFocusWithin] = useState(false);
	const [hovered, setHovered] = useState(false);
	const [canAutoRotate, setCanAutoRotate] = useState(false);

	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;

		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
		let inView = false;
		const sync = () => setCanAutoRotate(inView && !reducedMotion.matches);
		const observer = new IntersectionObserver(
			([entry]) => {
				inView = entry.isIntersecting;
				sync();
			},
			{ threshold: 0.35 },
		);

		observer.observe(root);
		reducedMotion.addEventListener("change", sync);
		return () => {
			observer.disconnect();
			reducedMotion.removeEventListener("change", sync);
		};
	}, []);

	useEffect(() => {
		if (!canAutoRotate || focusWithin || hovered) return;
		const interval = window.setInterval(() => {
			setAnimate(true);
			setActiveIndex((current) => (current + 1) % items.length);
		}, 6000);
		return () => window.clearInterval(interval);
	}, [canAutoRotate, focusWithin, hovered, items.length]);

	return (
		<div
			className="hero-card model-preview hero-code-rotator"
			data-animate={animate ? "true" : "false"}
			onBlurCapture={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) {
					setFocusWithin(false);
				}
			}}
			onFocusCapture={() => setFocusWithin(true)}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			ref={rootRef}
		>
			<div className="hero-code-stage">
				{items.map((item, index) => {
					const active = index === activeIndex;
					return (
						<div
							aria-hidden={!active}
							className="hero-code-panel"
							data-active={active ? "true" : "false"}
							inert={!active}
							key={item.key}
						>
							<div className="hero-card-head">
								<span className="qp-eyebrow">{item.file}</span>
								<span className="count">
									{String(index + 1).padStart(2, "0")} / {items.length}
								</span>
							</div>
							<CodeSample
								annotations={item.annotations}
								bare
								code={item.code}
								mark={item.mark}
								numbers
							/>
							<p className="hero-code-description">{item.description}</p>
						</div>
					);
				})}
			</div>

			<div aria-label="Choose code example" className="hero-code-nav">
				{items.map((item, index) => (
					<button
						aria-pressed={index === activeIndex}
						key={item.key}
						onClick={() => setActiveIndex(index)}
						onKeyDown={() => setAnimate(false)}
						onPointerDown={() => setAnimate(true)}
						type="button"
					>
						<span aria-hidden="true">0{index + 1}</span>
						{item.label}
					</button>
				))}
			</div>
		</div>
	);
}
