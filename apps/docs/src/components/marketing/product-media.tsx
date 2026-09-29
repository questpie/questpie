type ProductMediaProps = {
	alt: string;
	description: string;
	eyebrow: string;
	kind?: "image" | "video";
	poster?: string;
	src?: string;
	title: string;
	variant?: "hero" | "wide";
};

// Keep media optional until the final product captures exist. A missing source
// renders an honest, correctly sized handoff slot instead of speculative UI.
export function ProductMedia({
	alt,
	description,
	eyebrow,
	kind = "image",
	poster,
	src,
	title,
	variant = "wide",
}: ProductMediaProps) {
	return (
		<figure className={`product-media product-media-${variant}`}>
			{src ? (
				kind === "video" ? (
					<video
						aria-label={alt}
						controls
						loop
						muted
						playsInline
						poster={poster}
						preload="metadata"
						src={src}
					/>
				) : (
					<img alt={alt} loading="lazy" src={src} />
				)
			) : (
				<div className="product-media-placeholder">
					<span className="qp-eyebrow">{eyebrow}</span>
					<strong>{title}</strong>
					<p>{description}</p>
				</div>
			)}
			{src ? (
				<figcaption>
					<strong>{title}</strong>
					<span>{description}</span>
				</figcaption>
			) : null}
		</figure>
	);
}
