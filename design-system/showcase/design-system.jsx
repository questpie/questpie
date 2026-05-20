/* design-system.jsx — QUESTPIE Design System showcase + Tailwind/shadcn handoff */

const { useState } = React;

/* ---------- copy helper ---------- */
function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
    >
      <window.Icon name={copied ? "check" : "copy"} size={12} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function SectionBlock({ id, num, title, lede, children }) {
  return (
    <section id={id} style={{ padding: "56px 24px", borderTop: "1px solid var(--border-subtle)" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--foreground-subtle)", letterSpacing: "0.05em" }}>
            [{num}]
          </span>
          <h2 style={{ fontSize: 28, color: "var(--foreground)", letterSpacing: "-0.01em" }}>{title}</h2>
        </div>
        {lede && (
          <p className="balance" style={{ fontSize: 14.5, color: "var(--foreground-muted)", maxWidth: 640, marginBottom: 28 }}>
            {lede}
          </p>
        )}
        {children}
      </div>
    </section>
  );
}

function Swatch({ label, value, fg }) {
  return (
    <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ height: 78, background: value, borderBottom: "1px solid var(--border-subtle)" }} />
      <div style={{ padding: 12 }}>
        <div style={{ fontSize: 13, color: "var(--foreground)", fontWeight: 500 }}>{label}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--foreground-subtle)", marginTop: 2 }}>{value}</div>
      </div>
    </div>
  );
}

function TokenRow({ k, v, sample }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr 80px", padding: "12px 16px", borderBottom: "1px solid var(--border-subtle)", alignItems: "center", gap: 14 }}>
      <code className="mono" style={{ fontSize: 12, color: "var(--foreground)" }}>{k}</code>
      <span className="mono" style={{ fontSize: 12, color: "var(--foreground-muted)" }}>{v}</span>
      <span style={{ display: "flex", justifyContent: "flex-end" }}>{sample}</span>
    </div>
  );
}

function DSNav() {
  const items = [
    ["Foundations", "#foundations"],
    ["Typography", "#typography"],
    ["Buttons", "#buttons"],
    ["Inputs", "#inputs"],
    ["Cards & badges", "#cards"],
    ["Code & chrome", "#code"],
    ["Compositions", "#compositions"],
    ["Handoff", "#handoff"],
  ];
  const [theme, setTheme] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("light") ? "light" : "dark"
  );
  React.useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        background: "color-mix(in srgb, var(--background) 88%, transparent)",
        backdropFilter: "blur(14px) saturate(1.05)",
        borderBottom: "1px solid var(--border-subtle)",
        height: 56,
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: "100%", padding: "0 24px", gap: 18 }}>
        <a href="index.html" style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
          <window.Wordmark size={20} />
        </a>
        <span style={{ color: "var(--foreground-subtle)", fontSize: 13 }}>/ Design System</span>
        <nav style={{ display: "flex", gap: 4, marginLeft: "auto", color: "var(--foreground-muted)", fontSize: 13, overflowX: "auto" }} className="thin-scroll">
          {items.map(([label, href]) => (
            <a key={href} href={href} style={{ padding: "6px 10px", borderRadius: "var(--radius-control-inner)", color: "var(--foreground-muted)", whiteSpace: "nowrap" }}>
              {label}
            </a>
          ))}
        </nav>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          style={{ width: 32, padding: 0 }}
          aria-label="Toggle theme"
        >
          <window.Icon name={theme === "light" ? "moon" : "sun"} size={14} />
        </button>
      </div>
    </header>
  );
}

/* ---------- Hero ---------- */
function DSHero() {
  return (
    <section style={{ padding: "80px 24px 56px" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--foreground-subtle)", letterSpacing: "0.05em" }}>
          DS · v1 · neutral
        </span>
        <h1 style={{ marginTop: 16, fontSize: "clamp(34px, 2.2rem + 1.4vw, 48px)", lineHeight: 1.05, letterSpacing: "-0.02em", color: "var(--foreground)" }}>
          The QUESTPIE design system.
        </h1>
        <p className="balance" style={{ marginTop: 14, fontSize: 16, color: "var(--foreground-muted)", maxWidth: 580, lineHeight: 1.6 }}>
          Tokens, primitives and recipes used across Framework admin, docs, Cloud
          and Autopilot. Tailwind + shadcn ready handoff at the bottom.
        </p>
        <div style={{ marginTop: 24, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href="#foundations" className="btn btn-primary">
            Start with tokens
            <window.Icon name="arrowDown" size={14} />
          </a>
          <a href="#handoff" className="btn btn-secondary">
            Tailwind / shadcn handoff
            <window.Icon name="arrowDown" size={14} />
          </a>
        </div>
      </div>
    </section>
  );
}

/* ---------- 1 Foundations ---------- */
function Foundations() {
  return (
    <SectionBlock
      id="foundations"
      num="01"
      title="Foundations"
      lede="Semantic CSS variables wired into Tailwind via @theme inline. Pick the lowest token that expresses the structure."
    >
      <div style={{ marginBottom: 32 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Pillar accents</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }} className="ds-swatch-grid">
          <Swatch label="Primary (Framework)" value="#b700ff" />
          <Swatch label="Pillar — Cloud" value="#60a5fa" />
          <Swatch label="Pillar — Autopilot" value="#4ade80" />
          <Swatch label="Foreground" value="var(--foreground)" />
        </div>
      </div>

      <div style={{ marginBottom: 32 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Surface scale</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }} className="ds-swatch-grid">
          <Swatch label="background" value="var(--background)" />
          <Swatch label="surface-low" value="var(--surface-low)" />
          <Swatch label="surface-mid" value="var(--surface-mid)" />
          <Swatch label="surface-high" value="var(--surface-high)" />
          <Swatch label="card" value="var(--card)" />
        </div>
      </div>

      <div
        className="depth-surface"
        style={{ padding: 0, overflow: "hidden" }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr 80px", padding: "10px 16px", background: "var(--muted)", borderBottom: "1px solid var(--border-subtle)" }}>
          <span className="eyebrow">Token</span>
          <span className="eyebrow">Value</span>
          <span className="eyebrow" style={{ textAlign: "right" }}>Sample</span>
        </div>
        <TokenRow k="--radius-control-inner" v="8px" sample={<span style={{ width: 28, height: 28, borderRadius: 8, background: "var(--surface-high)" }} />} />
        <TokenRow k="--radius-control" v="12px" sample={<span style={{ width: 28, height: 28, borderRadius: 12, background: "var(--surface-high)" }} />} />
        <TokenRow k="--radius-surface" v="14px" sample={<span style={{ width: 28, height: 28, borderRadius: 14, background: "var(--surface-high)" }} />} />
        <TokenRow k="--control-height" v="40px" sample={<span style={{ width: 50, height: 40, borderRadius: 12, background: "var(--surface-high)", border: "1px solid var(--border)" }} />} />
        <TokenRow k="--control-height-sm" v="32px" sample={<span style={{ width: 50, height: 32, borderRadius: 8, background: "var(--surface-high)", border: "1px solid var(--border)" }} />} />
        <TokenRow k="--motion-base" v="150ms cubic-bezier(0.2,0,0,1)" sample={<span className="mono" style={{ fontSize: 11, color: "var(--foreground-subtle)" }}>standard</span>} />
        <TokenRow k="--motion-enter" v="cubic-bezier(0.22,1,0.36,1)" sample={<span className="mono" style={{ fontSize: 11, color: "var(--foreground-subtle)" }}>floating</span>} />
      </div>

      <style>{`
        @media (max-width: 880px) {
          .ds-swatch-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </SectionBlock>
  );
}

/* ---------- 2 Typography ---------- */
function TypographySection() {
  return (
    <SectionBlock
      id="typography"
      num="02"
      title="Typography"
      lede="Geist for UI + prose. JetBrains Mono only for code, IDs, paths, compact metadata. text-wrap: balance on headings, pretty on body."
    >
      <div className="depth-surface" style={{ padding: "28px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 18, alignItems: "baseline", borderBottom: "1px dashed var(--border-subtle)", paddingBottom: 14, marginBottom: 14 }}>
          <h1 style={{ fontSize: 56, lineHeight: 1.0, letterSpacing: "-0.025em" }}>Display headline</h1>
          <code className="mono" style={{ fontSize: 11, color: "var(--foreground-subtle)" }}>56 / 1.0 / -0.025em / 600</code>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 18, alignItems: "baseline", borderBottom: "1px dashed var(--border-subtle)", paddingBottom: 14, marginBottom: 14 }}>
          <h2 style={{ fontSize: 36 }}>Section heading</h2>
          <code className="mono" style={{ fontSize: 11, color: "var(--foreground-subtle)" }}>36 / 1.1 / -0.015em / 600</code>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 18, alignItems: "baseline", borderBottom: "1px dashed var(--border-subtle)", paddingBottom: 14, marginBottom: 14 }}>
          <h3 style={{ fontSize: 22 }}>Subsection heading</h3>
          <code className="mono" style={{ fontSize: 11, color: "var(--foreground-subtle)" }}>22 / 1.2 / 600</code>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 18, alignItems: "baseline", borderBottom: "1px dashed var(--border-subtle)", paddingBottom: 14, marginBottom: 14 }}>
          <p style={{ fontSize: 17, color: "var(--foreground-muted)", maxWidth: 580 }}>
            Body / lede. text-wrap pretty, 1.55–1.6 line height, max ~580px so it doesn't sprawl on wide screens.
          </p>
          <code className="mono" style={{ fontSize: 11, color: "var(--foreground-subtle)" }}>17 / 1.55 / 400</code>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 18, alignItems: "baseline", borderBottom: "1px dashed var(--border-subtle)", paddingBottom: 14, marginBottom: 14 }}>
          <span style={{ fontSize: 14, color: "var(--foreground)" }}>Body 14 — UI text inside controls and rows.</span>
          <code className="mono" style={{ fontSize: 11, color: "var(--foreground-subtle)" }}>14 / 1.5 / 400</code>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 18, alignItems: "baseline" }}>
          <span className="eyebrow">eyebrow · all caps · mono</span>
          <code className="mono" style={{ fontSize: 11, color: "var(--foreground-subtle)" }}>11 / 0.04em / 500</code>
        </div>
      </div>
    </SectionBlock>
  );
}

/* ---------- 3 Buttons ---------- */
function ButtonsSection() {
  return (
    <SectionBlock
      id="buttons"
      num="03"
      title="Buttons"
      lede="Three variants. Primary uses a subtle depth recipe (inset highlight + brand-tinted glow + bottom shadow) for hover-feedback. Secondary borrows the same recipe at lower intensity. Ghost stays flat."
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }} className="ds-buttons-grid">
        {[
          { variant: "primary", cls: "btn-primary", note: "Brand CTA. Linear gradient + inset highlight + brand glow + bottom shadow. translateY(1px) on press." },
          { variant: "secondary", cls: "btn-secondary", note: "Quiet action. Hairline border + soft inset highlight + 1px lift. Same press feedback." },
          { variant: "ghost", cls: "btn-ghost", note: "Transparent. Hover applies surface tint only. No depth." },
        ].map((b) => (
          <div
            key={b.variant}
            className="depth-surface"
            style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}
          >
            <div className="eyebrow">{b.variant}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className={`btn ${b.cls}`}>
                Button
                <window.Icon name="arrowRight" size={14} />
              </button>
              <button type="button" className={`btn ${b.cls} btn-sm`}>
                Small
              </button>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--foreground-muted)", lineHeight: 1.55 }}>{b.note}</p>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 22, padding: "14px 16px", border: "1px dashed var(--border)", background: "var(--surface-low)", borderRadius: "var(--radius-control)", fontSize: 12.5, color: "var(--foreground-muted)", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--foreground)" }}>Depth shadow recipe</strong> · inset top highlight (4–22% white) + inset bottom shade (8–18% black) + outer 2–6px brand-tinted glow. Press state swaps to inset shadow, transform translateY(1px).
      </div>

      <style>{`
        @media (max-width: 880px) {
          .ds-buttons-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </SectionBlock>
  );
}

/* ---------- 4 Inputs ---------- */
function InputsSection() {
  const [v, setV] = useState("");
  return (
    <SectionBlock
      id="inputs"
      num="04"
      title="Inputs"
      lede="Inputs use the same control tokens. Focus uses --border-strong + neutral ring, never the brand color."
    >
      <div className="depth-surface" style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }} className="ds-inputs-grid">
        <Field label="Text input" hint="Default state. 40px height, 12px radius.">
          <input
            placeholder="you@company.com"
            style={inputStyle}
          />
        </Field>
        <Field label="Filled + focus" hint="Focus uses --border-strong (not brand).">
          <input
            value={v || "marek@questpie.com"}
            onChange={(e) => setV(e.target.value)}
            style={{ ...inputStyle, borderColor: "var(--border-strong)", outline: "2px solid var(--ring)", outlineOffset: 2 }}
          />
        </Field>
        <Field label="Textarea" hint="Same control border, taller.">
          <textarea
            rows={3}
            placeholder="Describe the issue…"
            style={{ ...inputStyle, height: "auto", minHeight: 92, padding: "10px 14px", resize: "vertical", lineHeight: 1.5 }}
          />
        </Field>
        <Field label="Disabled" hint="No interaction. Faded foreground.">
          <input
            value="Disabled"
            disabled
            style={{ ...inputStyle, color: "var(--foreground-disabled)", background: "var(--surface-mid)", cursor: "not-allowed" }}
          />
        </Field>
      </div>
      <style>{`
        @media (max-width: 720px) {
          .ds-inputs-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </SectionBlock>
  );
}

const inputStyle = {
  height: 40,
  padding: "0 14px",
  borderRadius: "var(--radius-control)",
  border: "1px solid var(--border-subtle)",
  background: "var(--surface-low)",
  color: "var(--foreground)",
  fontSize: 14,
  width: "100%",
  outline: "none",
  fontFamily: "var(--font-sans)",
  boxShadow:
    "inset 0 1px 2px 0 color-mix(in srgb, black 14%, transparent), inset 0 0 0 1px color-mix(in srgb, var(--foreground) 2%, transparent)",
  transition: "border-color var(--motion-base) var(--ease-standard), box-shadow var(--motion-base) var(--ease-standard)",
};

function Field({ label, hint, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 13, color: "var(--foreground)", fontWeight: 500 }}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 11.5, color: "var(--foreground-subtle)" }}>{hint}</span>}
    </div>
  );
}

/* ---------- 5 Cards & Badges ---------- */
function CardsBadges() {
  return (
    <SectionBlock
      id="cards"
      num="05"
      title="Cards & badges"
      lede="Cards are flat — hairline border + var(--card). Use depth-surface only for elevated set-pieces (CTA, modals, hero panels). Badges stay neutral unless they mark live status."
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 18 }} className="ds-cards-grid">
        <div className="panel" style={{ padding: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Flat card</div>
          <p style={{ fontSize: 13.5, color: "var(--foreground)" }}>border-subtle on var(--card), radius 14, no shadow.</p>
        </div>
        <div className="panel-low" style={{ padding: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Low panel</div>
          <p style={{ fontSize: 13.5, color: "var(--foreground)" }}>For grouped content on the page background.</p>
        </div>
        <div className="depth-surface" style={{ padding: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Depth surface</div>
          <p style={{ fontSize: 13.5, color: "var(--foreground)" }}>Elevated CTA / modal. Subtle gradient + inset highlight + drop.</p>
        </div>
      </div>

      <div className="panel" style={{ padding: 20 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Status badges</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <window.StatusBadge tone="live">Live</window.StatusBadge>
          <window.StatusBadge tone="soon">Q3 2026</window.StatusBadge>
          <window.StatusBadge tone="beta">Beta</window.StatusBadge>
          <window.StatusBadge tone="neutral">Neutral</window.StatusBadge>
        </div>
      </div>

      <style>{`
        @media (max-width: 880px) { .ds-cards-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </SectionBlock>
  );
}

/* ---------- 6 Code & chrome ---------- */
function CodeChrome() {
  const lines = [
    [window.KW("export const "), window.TYP("posts"), " = ", window.FN("collection"), "(", window.STR('"posts"'), ")"],
    ["  .", window.FN("fields"), "(({ f }) => ({"],
    ["    title:   f.", window.FN("text"), "(", window.NUM("255"), ").", window.FN("required"), "(),"],
    ["    status:  f.", window.FN("select"), "([", window.STR('"draft"'), ", ", window.STR('"published"'), "]),"],
    ["  }));"],
  ];
  return (
    <SectionBlock
      id="code"
      num="06"
      title="Code & chrome"
      lede="Syntax tokens: keyword (brand-purple tint), function (cool blue), string (acid green), number (warm amber), comment (subtle). Code blocks use depth-surface for elevation; chrome strips look like real OS windows."
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="ds-code-grid">
        <window.CodeBlock filename="collections/posts.ts" lines={lines} />
        <div className="depth-surface" style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-low)" }}>
            <div style={{ display: "flex", gap: 4 }}>
              {[0,1,2].map(i => (<span key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--surface-high)" }} />))}
            </div>
            <span className="mono" style={{ fontSize: 11, color: "var(--foreground-subtle)" }}>terminal · zsh</span>
          </div>
          <pre style={{ margin: 0, padding: "14px 18px", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7, color: "var(--foreground)" }}>
{`$ bun create questpie my-app
→ scaffolding…
→ installing deps  ✓
→ migrating db     ✓
$ bun dev
ready on http://localhost:3000`}
          </pre>
        </div>
      </div>
      <style>{`
        @media (max-width: 880px) { .ds-code-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </SectionBlock>
  );
}

/* ---------- 7 Compositions ---------- */
function Compositions() {
  return (
    <SectionBlock
      id="compositions"
      num="07"
      title="Compositions"
      lede="Recipes used across landing pages. Combine primitives the same way and you'll get the same feel."
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="ds-comp-grid">
        {/* depth CTA */}
        <div className="depth-surface" style={{ padding: 28, textAlign: "center" }}>
          <window.Eyebrow dot color="var(--primary)">Coming Q4 2026</window.Eyebrow>
          <h3 style={{ marginTop: 12, fontSize: 26, color: "var(--foreground)", letterSpacing: "-0.015em" }}>
            Be early on Autopilot.
          </h3>
          <p style={{ marginTop: 8, fontSize: 13, color: "var(--foreground-muted)", maxWidth: 360, marginInline: "auto" }}>
            CTA recipe: depth-surface + eyebrow + balanced headline + lede + primary button.
          </p>
          <div style={{ marginTop: 16, display: "inline-flex", gap: 8 }}>
            <button className="btn btn-primary">Get early access<window.Icon name="arrowRight" size={14} /></button>
          </div>
        </div>

        {/* feature card */}
        <div className="panel" style={{ padding: 20 }}>
          <window.Icon name="bolt" size={16} style={{ color: "var(--pillar-framework)", marginBottom: 12 }} />
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Feature card</div>
          <p style={{ fontSize: 12.5, color: "var(--foreground-muted)", lineHeight: 1.55 }}>
            Flat panel + accent icon + title + 1–2 line description. Live in 2/3/4-col hairline grids.
          </p>
        </div>

        {/* stat row */}
        <div className="panel" style={{ padding: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Stat row</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0, borderTop: "1px solid var(--border-subtle)", borderBottom: "1px solid var(--border-subtle)" }}>
            {[["Deploys/7d", "127"],["p95", "84ms"],["Uptime", "99.99%"]].map(([k,v], i) => (
              <div key={k} style={{ padding: "12px 0", borderRight: i < 2 ? "1px solid var(--border-subtle)" : "none", paddingLeft: i === 0 ? 0 : 14 }}>
                <div className="mono tabular" style={{ fontSize: 18, color: "var(--foreground)", fontWeight: 600 }}>{v}</div>
                <div className="eyebrow">{k}</div>
              </div>
            ))}
          </div>
        </div>

        {/* list row */}
        <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", background: "var(--muted)", borderBottom: "1px solid var(--border-subtle)" }}>
            <span className="eyebrow">Dense row</span>
          </div>
          {["Publish Q3 launch", "Fix DNS edge case", "Weekly newsletter"].map((t, i) => (
            <div key={t} style={{ padding: "11px 14px", borderBottom: i === 2 ? "none" : "1px solid var(--border-subtle)", display: "grid", gridTemplateColumns: "1fr 80px", fontSize: 13, alignItems: "center" }}>
              <span>{t}</span>
              <span className="mono tabular" style={{ textAlign: "right", color: "var(--foreground-subtle)", fontSize: 11 }}>2m</span>
            </div>
          ))}
        </div>
      </div>
      <style>{`
        @media (max-width: 880px) { .ds-comp-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </SectionBlock>
  );
}

/* ---------- 8 Handoff: Tailwind + shadcn ---------- */
const TAILWIND_V4_CSS = `/* app.css — Tailwind v4 setup. No tailwind.config.ts needed. */
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

/* 1) QUESTPIE tokens — paste under your own theme file */
:root, .dark {
  color-scheme: dark;
  --background: #121212;
  --foreground: #ececec;
  --foreground-muted: #a0a0a0;
  --foreground-subtle: #737373;
  --surface-low: #1b1b1b;
  --surface-mid: #222;
  --surface-high: #2a2a2a;
  --card: #1b1b1b;
  --popover: #1b1b1b;
  --muted: #222;
  --primary: #b700ff;
  --primary-foreground: #fff;
  --destructive: #ff5f6d;
  --success: #4ade80;
  --border-subtle: #262626;
  --border: #343434;
  --border-strong: #4a4a4a;
  --ring: #737373;
  --pillar-cloud: #60a5fa;
  --pillar-autopilot: #4ade80;
  --radius: 0.75rem; /* shadcn convention; map components to this */
}
.light {
  color-scheme: light;
  --background: #fafafa;
  --foreground: #1c1c1c;
  --foreground-muted: #616161;
  --foreground-subtle: #858585;
  --surface-low: #ffffff;
  --surface-mid: #f0f0f0;
  --surface-high: #e8e8e8;
  --card: #ffffff;
  --popover: #ffffff;
  --muted: #f0f0f0;
  --border-subtle: #ebebeb;
  --border: #e2e2e2;
  --border-strong: #c9c9c9;
  --ring: #858585;
}

/* 2) Bridge to Tailwind v4 — semantic utilities + radius scale */
@theme inline {
  --font-sans: "Geist", "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-foreground-muted: var(--foreground-muted);
  --color-foreground-subtle: var(--foreground-subtle);
  --color-card: var(--card);
  --color-popover: var(--popover);
  --color-muted: var(--muted);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border-subtle);
  --color-border-strong: var(--border-strong);
  --color-input: var(--border-subtle);
  --color-ring: var(--ring);

  --color-pillar-cloud: var(--pillar-cloud);
  --color-pillar-autopilot: var(--pillar-autopilot);

  --radius-sm: 0.5rem;   /* 8px */
  --radius-md: 0.75rem;  /* 12px */
  --radius-lg: 0.875rem; /* 14px */

  --animate-fade-in: fade-in 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
`;

const SHADCN_TOKENS = `/* shadcn token mapping — drop into the same app.css under tokens block.
   shadcn components ship with these CSS variable names. Point them at
   QUESTPIE tokens and they'll inherit theme + light/dark automatically. */
:root, .dark, .light {
  /* shadcn semantic */
  --background: var(--background);
  --foreground: var(--foreground);
  --card: var(--card);
  --card-foreground: var(--foreground);
  --popover: var(--popover);
  --popover-foreground: var(--foreground);
  --primary: var(--primary);
  --primary-foreground: var(--primary-foreground);
  --secondary: var(--surface-mid);
  --secondary-foreground: var(--foreground);
  --muted: var(--muted);
  --muted-foreground: var(--foreground-muted);
  --accent: var(--surface-high);
  --accent-foreground: var(--foreground);
  --destructive: var(--destructive);
  --destructive-foreground: #ffffff;
  --border: var(--border-subtle);
  --input: var(--border-subtle);
  --ring: var(--ring);
  --radius: 0.75rem;
}

/* If you're on shadcn's new --primary @ HSL contract instead of raw hex,
   it just works — color-mix and CSS color functions resolve at runtime. */
`;

const SHADCN_BUTTON = `// components/ui/button.tsx — shadcn Button with depth-shadow primary
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,color,border-color,box-shadow,transform] duration-150 active:translate-y-px focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // Depth brand CTA — gradient + inset highlight + brand glow + bottom shadow
        primary:
          "text-primary-foreground bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--primary)_100%,white_4%),var(--primary))] " +
          "shadow-[inset_0_1px_0_0_color-mix(in_srgb,white_22%,transparent),inset_0_-1px_0_0_color-mix(in_srgb,black_18%,transparent),0_1px_2px_-1px_color-mix(in_srgb,var(--primary)_60%,transparent),0_2px_6px_-2px_rgba(0,0,0,0.35)] " +
          "hover:bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--primary)_100%,white_10%),color-mix(in_srgb,var(--primary)_95%,white_0%))]",
        secondary:
          "text-foreground border border-border " +
          "bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--card)_100%,var(--foreground)_2%),var(--card))] " +
          "shadow-[inset_0_1px_0_0_color-mix(in_srgb,var(--foreground)_6%,transparent),0_1px_2px_-1px_rgba(0,0,0,0.18)] " +
          "hover:bg-secondary hover:border-border-strong",
        ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
        destructive: "bg-destructive text-white hover:opacity-90",
      },
      size: {
        sm: "h-8 px-3 rounded-sm text-[13px]",
        md: "h-10 px-4",
        lg: "h-11 px-5",
        icon: "h-8 w-8 p-0 rounded-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
    );
  }
);
Button.displayName = "Button";
`;

function HandoffSection() {
  return (
    <SectionBlock
      id="handoff"
      num="08"
      title="Handoff — Tailwind v4 + shadcn"
      lede="No tailwind.config.ts. Tailwind v4 uses CSS-first @theme. Drop the tokens block in, bridge it to Tailwind via @theme inline, then map shadcn token names to the QUESTPIE tokens. Components inherit theme + light/dark automatically."
    >
      <HandoffBlock filename="app.css — tokens + @theme inline" code={TAILWIND_V4_CSS} />
      <div style={{ height: 14 }} />
      <HandoffBlock filename="app.css — shadcn token mapping" code={SHADCN_TOKENS} />
      <div style={{ height: 14 }} />
      <HandoffBlock filename="components/ui/button.tsx — shadcn, neutral flat" code={SHADCN_BUTTON} />

      <div style={{ marginTop: 22, padding: "14px 16px", border: "1px dashed var(--border)", background: "var(--surface-low)", borderRadius: "var(--radius-control)", fontSize: 12.5, color: "var(--foreground-muted)", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--foreground)" }}>Three blocks, one CSS file.</strong> Tokens at the top, @theme inline in the middle, shadcn aliases at the bottom. Restart dev, theme works in light + dark, primary stays reserved for CTAs and brand marks.
      </div>
    </SectionBlock>
  );
}

function HandoffBlock({ filename, code }) {
  return (
    <div className="panel-low" style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-low)" }}>
        <span className="mono" style={{ fontSize: 12, color: "var(--foreground)" }}>{filename}</span>
        <CopyBtn text={code} />
      </div>
      <pre
        className="thin-scroll"
        style={{
          margin: 0,
          padding: "16px 18px",
          fontFamily: "var(--font-mono)",
          fontSize: 12.5,
          lineHeight: 1.65,
          color: "var(--foreground)",
          background: "var(--card)",
          overflow: "auto",
          maxHeight: 420,
        }}
      >
        {code}
      </pre>
    </div>
  );
}

/* ---------- App ---------- */
function DSApp() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      <DSNav />
      <main>
        <DSHero />
        <Foundations />
        <TypographySection />
        <ButtonsSection />
        <InputsSection />
        <CardsBadges />
        <CodeChrome />
        <window.ExtrasIndex />
        <Compositions />
        <HandoffSection />
      </main>
      <window.SharedFooter />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<DSApp />);
