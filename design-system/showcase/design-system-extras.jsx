/* design-system-extras.jsx — complex primitives: sidebar, issue table,
   activity timeline, chat composer, inputs, selects, property sidebar */

const { useState: useS } = React;

/* ---------- Section heading reuse via local helper ---------- */
function ExSection({ id, num, title, lede, children }) {
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

/* ============= 09 · INPUTS — full set ============= */
const inS = {
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

function InputsFull() {
  const [n, setN] = useS(24);
  return (
    <ExSection
      id="inputs-full"
      num="09"
      title="Inputs — full set"
      lede="All input shapes share control height (40px), radius (12px), and border tokens. Use the prefix/suffix slot for units, icons or shortcut hints."
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }} className="ds-input-full-grid">
        {/* Text + icon prefix */}
        <Lbl label="With prefix icon">
          <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-control)", background: "var(--surface-low)", height: 40, paddingLeft: 12 }}>
            <window.Icon name="search" size={14} style={{ color: "var(--foreground-subtle)" }} />
            <input placeholder="Search issues…" style={{ ...inS, border: "none", background: "transparent", height: 38, paddingLeft: 8 }} />
          </div>
        </Lbl>
        {/* With kbd shortcut */}
        <Lbl label="With shortcut hint">
          <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-control)", background: "var(--surface-low)", height: 40, paddingRight: 8 }}>
            <input placeholder="Quick command…" style={{ ...inS, border: "none", background: "transparent", height: 38, paddingRight: 8 }} />
            <span className="mono" style={{ fontSize: 10, padding: "3px 6px", border: "1px solid var(--border-subtle)", borderRadius: 4, color: "var(--foreground-subtle)", background: "var(--surface)" }}>⌘K</span>
          </div>
        </Lbl>
        {/* With unit suffix */}
        <Lbl label="With unit suffix">
          <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-control)", background: "var(--surface-low)", height: 40, paddingRight: 12 }}>
            <input type="number" value={n} onChange={(e) => setN(e.target.value)} style={{ ...inS, border: "none", background: "transparent", height: 38 }} />
            <span style={{ fontSize: 12, color: "var(--foreground-subtle)" }}>days</span>
          </div>
        </Lbl>

        {/* Error state */}
        <Lbl label="Error state" hint="Border + helper text use destructive, never decorative.">
          <input
            placeholder="email@…"
            style={{ ...inS, borderColor: "var(--destructive)", color: "var(--foreground)" }}
          />
          <span style={{ fontSize: 11.5, color: "var(--destructive)" }}>Email is required.</span>
        </Lbl>

        {/* Inline switch (boolean) */}
        <Lbl label="Toggle">
          <div style={{ display: "flex", alignItems: "center", gap: 10, height: 40 }}>
            <Toggle />
            <span style={{ fontSize: 13, color: "var(--foreground)" }}>Enable notifications</span>
          </div>
        </Lbl>

        {/* Checkbox row */}
        <Lbl label="Checkbox row">
          <div style={{ display: "flex", flexDirection: "column", gap: 6, height: 40, justifyContent: "center" }}>
            <Check defaultChecked label="Production deploy" />
            <Check label="Send to channel" />
          </div>
        </Lbl>
      </div>
      <style>{`
        @media (max-width: 880px) { .ds-input-full-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </ExSection>
  );
}

function Lbl({ label, hint, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 13, color: "var(--foreground)", fontWeight: 500 }}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 11.5, color: "var(--foreground-subtle)" }}>{hint}</span>}
    </div>
  );
}

function Toggle({ defaultOn = true }) {
  const [on, setOn] = useS(defaultOn);
  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      style={{
        width: 36, height: 20, borderRadius: 999,
        background: on ? "var(--primary)" : "var(--surface-high)",
        border: "1px solid",
        borderColor: on ? "var(--primary)" : "var(--border)",
        position: "relative",
        transition: "background-color var(--motion-base) var(--ease-standard)",
        cursor: "pointer",
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: on ? 18 : 2,
        width: 14, height: 14, borderRadius: "50%",
        background: "#fff",
        transition: "left var(--motion-base) var(--ease-standard)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
      }} />
    </button>
  );
}

function Check({ defaultChecked, label }) {
  const [c, setC] = useS(!!defaultChecked);
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "var(--foreground)" }}>
      <span
        onClick={() => setC(!c)}
        style={{
          width: 16, height: 16, borderRadius: 4,
          border: "1px solid",
          borderColor: c ? "var(--primary)" : "var(--border)",
          background: c ? "var(--primary)" : "var(--surface-low)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: "white",
          transition: "all var(--motion-base) var(--ease-standard)",
        }}
      >
        {c && <window.Icon name="check" size={11} stroke={2.5} />}
      </span>
      {label}
    </label>
  );
}

/* ============= 10 · SELECTS ============= */
function SelectsSection() {
  return (
    <ExSection
      id="selects"
      num="10"
      title="Selects & comboboxes"
      lede="Native-looking single select, multi-select tag input, and a searchable combobox with command-palette feel."
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }} className="ds-select-grid">
        <Lbl label="Single select">
          <SingleSelect />
        </Lbl>
        <Lbl label="Multi tag input">
          <MultiSelect />
        </Lbl>
        <Lbl label="Searchable combobox">
          <Combobox />
        </Lbl>
      </div>
      <style>{`
        @media (max-width: 880px) { .ds-select-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </ExSection>
  );
}

function SingleSelect() {
  const [v, setV] = useS("in_review");
  const opts = [
    { value: "backlog", label: "Backlog" },
    { value: "todo", label: "Todo" },
    { value: "in_progress", label: "In progress" },
    { value: "in_review", label: "In review" },
    { value: "done", label: "Done" },
  ];
  const current = opts.find((o) => o.value === v);
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        style={{ ...inS, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
      >
        {current?.label}
        <window.Icon name="caretDown" size={11} style={{ color: "var(--foreground-subtle)" }} />
      </button>
      <div
        style={{
          marginTop: 8,
          background: "var(--popover)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-floating)",
          padding: 4,
          boxShadow: "var(--floating-shadow)",
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        {opts.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setV(o.value)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "7px 10px",
              borderRadius: "var(--radius-control-inner)",
              background: o.value === v ? "var(--surface-high)" : "transparent",
              color: "var(--foreground)",
              fontSize: 13,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => { if (o.value !== v) e.currentTarget.style.background = "var(--surface-mid)"; }}
            onMouseLeave={(e) => { if (o.value !== v) e.currentTarget.style.background = "transparent"; }}
          >
            {o.label}
            {o.value === v && <window.Icon name="check" size={12} style={{ color: "var(--foreground-subtle)" }} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function MultiSelect() {
  const [tags, setTags] = useS(["urgent", "frontend"]);
  return (
    <div
      style={{
        minHeight: 40,
        border: "1px solid var(--border-subtle)",
        background: "var(--surface-low)",
        borderRadius: "var(--radius-control)",
        padding: "6px 10px",
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        alignItems: "center",
      }}
    >
      {tags.map((t) => (
        <span
          key={t}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 4px 3px 8px",
            background: "var(--surface-high)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--foreground)",
          }}
        >
          {t}
          <button
            type="button"
            onClick={() => setTags(tags.filter((x) => x !== t))}
            style={{ width: 16, height: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--foreground-subtle)", borderRadius: 4, cursor: "pointer" }}
          >
            <window.Icon name="x" size={10} />
          </button>
        </span>
      ))}
      <input
        placeholder="Add label…"
        style={{ flex: 1, minWidth: 100, border: "none", background: "transparent", outline: "none", fontSize: 13, color: "var(--foreground)" }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.currentTarget.value) {
            setTags([...tags, e.currentTarget.value]);
            e.currentTarget.value = "";
          }
        }}
      />
    </div>
  );
}

function Combobox() {
  return (
    <div
      style={{
        border: "1px solid var(--border-subtle)",
        background: "var(--popover)",
        borderRadius: "var(--radius-floating)",
        overflow: "hidden",
        boxShadow: "var(--floating-shadow)",
      }}
    >
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 8 }}>
        <window.Icon name="search" size={13} style={{ color: "var(--foreground-subtle)" }} />
        <input
          placeholder="Search command…"
          style={{ border: "none", background: "transparent", outline: "none", flex: 1, color: "var(--foreground)", fontSize: 13 }}
        />
        <span className="mono" style={{ fontSize: 10, padding: "2px 6px", border: "1px solid var(--border-subtle)", borderRadius: 4, color: "var(--foreground-subtle)" }}>ESC</span>
      </div>
      <div style={{ padding: 4, maxHeight: 180, overflowY: "auto" }}>
        {[
          ["Create issue", "ph:plus"],
          ["Run workflow", "ph:flow-arrow"],
          ["Open project", "ph:folder"],
          ["Invite teammate", "ph:user"],
        ].map(([label, icon]) => (
          <button
            key={label}
            type="button"
            style={{
              width: "100%",
              padding: "7px 10px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              borderRadius: "var(--radius-control-inner)",
              background: "transparent",
              color: "var(--foreground)",
              fontSize: 13,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-mid)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <window.Icon name="bolt" size={13} style={{ color: "var(--foreground-subtle)" }} />
            {label}
            <span className="mono" style={{ marginLeft: "auto", fontSize: 10, color: "var(--foreground-subtle)" }}>↵</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============= 11 · CARDS — more variants ============= */
function CardsMore() {
  return (
    <ExSection
      id="cards-more"
      num="11"
      title="Card variants"
      lede="Common card shapes used across the product. Same panel base, different content density and lead."
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }} className="ds-cards-more">
        {/* Icon-led */}
        <div className="panel" style={{ padding: 20 }}>
          <window.Icon name="rocket" size={18} style={{ color: "var(--pillar-cloud)", marginBottom: 14 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--foreground)" }}>One-click deploy</div>
          <p style={{ marginTop: 6, fontSize: 13, color: "var(--foreground-muted)", lineHeight: 1.55 }}>
            Health-checked deploys with safe switchover and rollback.
          </p>
        </div>

        {/* Number-led / metric */}
        <div className="panel" style={{ padding: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Deploys / 7d</div>
          <div className="mono tabular" style={{ fontSize: 36, color: "var(--foreground)", fontWeight: 600, letterSpacing: "-0.01em" }}>127</div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6, fontSize: 12, color: "var(--success)" }}>
            <window.Icon name="arrowUpRight" size={11} />
            +18% vs last week
          </div>
        </div>

        {/* Issue-style */}
        <div className="panel" style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span className="mono tabular" style={{ fontSize: 11, color: "var(--foreground-subtle)" }}>QAP-4821</span>
            <window.StatusBadge tone="beta">In review</window.StatusBadge>
          </div>
          <div style={{ fontSize: 14, color: "var(--foreground)", fontWeight: 500 }}>
            Publish Q3 launch announcement
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center", fontSize: 11.5, color: "var(--foreground-subtle)" }}>
            <span className="mono">workflow: review-content</span>
            <span style={{ marginLeft: "auto" }}>2m ago</span>
          </div>
        </div>

        {/* Highlight card with depth */}
        <div className="depth-surface" style={{ padding: 22 }}>
          <window.Eyebrow dot color="var(--primary)">Recommended</window.Eyebrow>
          <div style={{ marginTop: 8, fontSize: 15, fontWeight: 600 }}>Cloud · Pro</div>
          <div style={{ marginTop: 4, fontSize: 22, fontWeight: 600 }}>$49 <span className="mono" style={{ fontSize: 12, color: "var(--foreground-subtle)" }}>/ mo</span></div>
          <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 14, width: "100%" }}>
            Choose plan
            <window.Icon name="arrowRight" size={12} />
          </button>
        </div>

        {/* Empty state */}
        <div className="panel" style={{ padding: 24, textAlign: "center", borderStyle: "dashed" }}>
          <window.Icon name="search" size={20} style={{ color: "var(--foreground-subtle)", marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--foreground)" }}>No matching issues</div>
          <p style={{ marginTop: 6, fontSize: 12.5, color: "var(--foreground-muted)" }}>
            Try removing a filter or pick a different project.
          </p>
        </div>

        {/* CTA inline */}
        <div className="panel" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12, justifyContent: "space-between" }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Knowledge</div>
            <div style={{ fontSize: 14, color: "var(--foreground)", fontWeight: 500 }}>Add a brand-voice doc</div>
            <p style={{ marginTop: 4, fontSize: 12.5, color: "var(--foreground-muted)" }}>
              Workflows ground answers on stored docs. Drop a markdown file in.
            </p>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start" }}>
            Upload doc
            <window.Icon name="arrowRight" size={12} />
          </button>
        </div>
      </div>
      <style>{`
        @media (max-width: 880px) { .ds-cards-more { grid-template-columns: 1fr !important; } }
      `}</style>
    </ExSection>
  );
}

/* ============= 12 · SIDEBAR + ISSUE LIST LAYOUT ============= */
function SidebarLayout() {
  return (
    <ExSection
      id="sidebar"
      num="12"
      title="Sidebar + issue list"
      lede="The autopilot admin shell. Sidebar with sections and items, a dense Linear-style issue table, and a property drawer feel."
    >
      <div
        className="depth-surface"
        style={{ overflow: "hidden", display: "grid", gridTemplateColumns: "220px 1fr", minHeight: 460 }}
      >
        <Sidebar />
        <IssueListMock />
      </div>
    </ExSection>
  );
}

function Sidebar() {
  return (
    <div style={{ background: "var(--sidebar, var(--surface))", borderRight: "1px solid var(--border-subtle)", padding: 12, fontSize: 13, color: "var(--foreground-muted)" }}>
      <div style={{ padding: "6px 8px", display: "flex", alignItems: "center", gap: 8 }}>
        <window.Mark size={18} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>marketing-site</span>
      </div>
      <SidebarItem icon="layout" label="Home" />
      <SidebarItem icon="circle" label="Issues" badge="14" active />
      <SidebarItem icon="flow" label="Workflows" />
      <SidebarItem icon="calendar" label="Schedules" />
      <SidebarItem icon="book" label="Knowledge" />
      <SidebarItem icon="folder" label="Projects" />

      <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px solid var(--border-subtle)" }}>
        <div className="eyebrow" style={{ padding: "0 8px 6px" }}>Workspace</div>
        <SidebarItem icon="users" label="Team" />
        <SidebarItem icon="bolt" label="Settings" />
      </div>
    </div>
  );
}

function SidebarItem({ icon, label, badge, active }) {
  return (
    <a
      href="#"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 8px",
        borderRadius: "var(--radius-control-inner)",
        color: active ? "var(--foreground)" : "var(--foreground-muted)",
        background: active ? "var(--surface-high)" : "transparent",
        fontWeight: active ? 500 : 400,
        marginTop: 1,
        textDecoration: "none",
        position: "relative",
      }}
    >
      <window.Icon name={icon} size={14} style={{ color: active ? "var(--foreground)" : "var(--foreground-subtle)" }} />
      <span style={{ flex: 1 }}>{label}</span>
      {badge && (
        <span className="mono tabular" style={{ fontSize: 10.5, color: "var(--foreground-subtle)" }}>{badge}</span>
      )}
    </a>
  );
}

function IssueListMock() {
  const issues = [
    { id: "QAP-4821", title: "Publish Q3 launch announcement", status: "in_review", project: "Marketing", t: "2m" },
    { id: "QAP-4818", title: "Fix DNS for marekstreet.barbers", status: "in_progress", project: "Cloud ops", t: "12m" },
    { id: "QAP-4815", title: "Weekly newsletter draft", status: "todo", project: "Marketing", t: "1h" },
    { id: "QAP-4801", title: "Investigate slow listing queries", status: "backlog", project: "Realtor app", t: "yesterday" },
    { id: "QAP-4799", title: "Review June P&L", status: "done", project: "Internal", t: "yesterday" },
  ];
  const SC = {
    backlog: "var(--foreground-subtle)", todo: "var(--foreground-muted)",
    in_progress: "#eab308", in_review: "#22c55e", done: "#818cf8",
  };
  const SL = { backlog: "Backlog", todo: "Todo", in_progress: "In progress", in_review: "In review", done: "Done" };
  return (
    <div style={{ display: "flex", flexDirection: "column", background: "var(--background)" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Issues</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--foreground-subtle)" }}>14 open</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <span className="mono" style={{ fontSize: 11, padding: "3px 9px", borderRadius: 6, background: "var(--surface-high)", color: "var(--foreground)", border: "1px solid var(--border)" }}>Open</span>
          <span className="mono" style={{ fontSize: 11, padding: "3px 9px", borderRadius: 6, color: "var(--foreground-muted)" }}>Needs review</span>
          <span className="mono" style={{ fontSize: 11, padding: "3px 9px", borderRadius: 6, color: "var(--foreground-muted)" }}>Done</span>
        </div>
        <button type="button" className="btn btn-primary btn-sm">
          <window.Icon name="plus" size={11} />
          New
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {issues.map((i, idx) => (
          <div
            key={i.id}
            style={{
              display: "grid",
              gridTemplateColumns: "78px 16px 1fr 100px 60px",
              padding: "10px 16px",
              borderBottom: idx === issues.length - 1 ? "none" : "1px solid var(--border-subtle)",
              fontSize: 13,
              alignItems: "center",
              gap: 10,
            }}
          >
            <span className="mono tabular" style={{ fontSize: 11, color: "var(--foreground-subtle)" }}>{i.id}</span>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "transparent", border: "2px solid", borderColor: SC[i.status], opacity: i.status === "done" ? 1 : 0.95, position: "relative" }}>
              {i.status === "in_progress" && (
                <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `conic-gradient(${SC[i.status]} 50%, transparent 0)` }} />
              )}
              {i.status === "done" && (
                <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: SC[i.status] }} />
              )}
            </span>
            <span style={{ color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.title}</span>
            <span style={{ color: "var(--foreground-muted)", fontSize: 12 }}>{i.project}</span>
            <span className="mono tabular" style={{ textAlign: "right", color: "var(--foreground-subtle)", fontSize: 11 }}>{i.t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============= 13 · ACTIVITY TIMELINE + PROPERTY DRAWER ============= */
function IssueDetailLayout() {
  return (
    <ExSection
      id="issue-detail"
      num="13"
      title="Issue detail — activity + properties"
      lede="Right-side property drawer + activity timeline. Each timeline entry has time, actor, and a one-line outcome. Steps from workflow runs hang off the same timeline."
    >
      <div className="depth-surface" style={{ overflow: "hidden", display: "grid", gridTemplateColumns: "1fr 260px" }}>
        {/* Activity */}
        <div style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span className="mono tabular" style={{ fontSize: 12, color: "var(--foreground-subtle)" }}>QAP-4821</span>
            <window.StatusBadge tone="beta">In review</window.StatusBadge>
          </div>
          <h3 style={{ fontSize: 22, color: "var(--foreground)", letterSpacing: "-0.01em" }}>
            Publish Q3 launch announcement
          </h3>
          <p style={{ marginTop: 8, fontSize: 13, color: "var(--foreground-muted)" }}>
            Draft → fact-check → SEO pass → human approval → publish.
          </p>

          <div style={{ marginTop: 22 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Activity</div>
            {[
              ["08:12", "Marek", "Created issue · attached workflow review-content", null],
              ["08:12", "step.run", "draft ✓ generated 612 words", "done"],
              ["08:14", "step.run", "fact-check ✓ 3 sources verified", "done"],
              ["08:15", "step.run", "seo-pass ✓ title + meta updated", "done"],
              ["08:16", "step.waitForEvent", "human-approval", "wait"],
              ["—", "step.run", "publish · queued", "queue"],
            ].map(([t, who, text, st], i, arr) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "48px 1fr", gap: 12, padding: "8px 0", borderTop: i === 0 ? "none" : "1px dashed var(--border-subtle)", fontSize: 12.5 }}>
                <span className="mono tabular" style={{ color: "var(--foreground-subtle)", fontSize: 11 }}>{t}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: st === "done" ? "var(--success)" : st === "wait" ? "var(--pillar-autopilot)" : "var(--foreground-subtle)",
                    boxShadow: st === "wait" ? `0 0 0 3px color-mix(in srgb, var(--pillar-autopilot) 25%, transparent)` : "none",
                  }} />
                  <code style={{ fontSize: 11.5, color: who.includes("step.") ? "var(--pillar-autopilot)" : "var(--foreground-muted)" }}>{who}</code>
                  <span style={{ color: "var(--foreground)" }}>{text}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Property drawer */}
        <div style={{ background: "var(--surface-low)", borderLeft: "1px solid var(--border-subtle)", padding: "20px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          <PropRow label="Status" value={<window.StatusBadge tone="beta">In review</window.StatusBadge>} />
          <PropRow label="Type" value={<span style={{ fontSize: 12.5 }}>Feature</span>} />
          <PropRow label="Project" value={<span style={{ fontSize: 12.5 }}>Marketing site</span>} />
          <PropRow label="Workflow" value={<code style={{ fontSize: 11.5, color: "var(--pillar-autopilot)" }}>review-content</code>} />
          <PropRow label="Assignee" value={<span style={{ fontSize: 12.5 }}>@marek</span>} />
          <PropRow label="Created" value={<span className="mono tabular" style={{ fontSize: 11.5, color: "var(--foreground-muted)" }}>Aug 18, 08:12</span>} />
        </div>
      </div>
    </ExSection>
  );
}
function PropRow({ label, value }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="eyebrow">{label}</span>
      {value}
    </div>
  );
}

/* ============= 14 · CHAT COMPOSER + MESSAGE THREAD ============= */
function ChatLayout() {
  const [v, setV] = useS("");
  return (
    <ExSection
      id="chat"
      num="14"
      title="Chat composer + message thread"
      lede="Two-pane shell used by the Autopilot builder and customer-conversation surfaces. Agent vs human bubbles, optional diff trail, prompt chips, command input."
    >
      <div className="depth-surface" style={{ overflow: "hidden", display: "grid", gridTemplateColumns: "1fr 260px", minHeight: 420 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-low)", display: "flex", alignItems: "center", gap: 10 }}>
            <window.Icon name="chat" size={13} style={{ color: "var(--pillar-autopilot)" }} />
            <span className="mono" style={{ fontSize: 11, color: "var(--foreground)" }}>thread · #ops</span>
            <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--foreground-subtle)" }}>12 messages</span>
          </div>
          <div style={{ flex: 1, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <Bubble who="agent" text="Drafted the announcement. 612 words, brand tone, embedded the Q3 metric callouts." diff={["+ Hero copy", "+ Pricing block", "~ CTA wording"]} />
            <Bubble who="user" text="Tighten the hero, drop the founder quote." />
            <Bubble who="agent" text="Done. Tightened hero (-38 words), removed founder quote. Preview ready." />
          </div>
          <div style={{ padding: 12, borderTop: "1px solid var(--border-subtle)", background: "var(--surface-low)" }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              {["Suggest 3 alt headlines", "Translate to Slovak", "Add CTA"].map((p) => (
                <span key={p} className="mono" style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: "var(--surface-mid)", color: "var(--foreground-muted)", border: "1px solid var(--border-subtle)" }}>
                  {p}
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", border: "1px solid var(--border)", background: "var(--card)", borderRadius: "var(--radius-control)", padding: "8px 12px" }}>
              <window.Icon name="spark" size={13} style={{ color: "var(--foreground-subtle)" }} />
              <input
                value={v}
                onChange={(e) => setV(e.target.value)}
                placeholder="Send a message…"
                style={{ flex: 1, border: "none", background: "transparent", outline: "none", color: "var(--foreground)", fontSize: 13 }}
              />
              <span className="mono" style={{ fontSize: 10, padding: "2px 6px", border: "1px solid var(--border-subtle)", borderRadius: 4, color: "var(--foreground-subtle)" }}>⏎</span>
            </div>
          </div>
        </div>

        {/* right rail: participants + tools */}
        <div style={{ background: "var(--surface-low)", borderLeft: "1px solid var(--border-subtle)", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Participants</div>
            {[
              ["@marek", "var(--foreground)"],
              ["agent:content-team-01", "var(--pillar-autopilot)"],
              ["agent:seo-bot", "var(--pillar-autopilot)"],
            ].map(([name, color]) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12.5 }}>
                <span style={{ width: 6, height: 6, borderRadius: 2, background: color }} />
                <span style={{ color: name.startsWith("agent") ? "var(--pillar-autopilot)" : "var(--foreground)" }}>{name}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Available tools</div>
            {["collections.posts", "knowledge.search", "cloud.deploy"].map((t) => (
              <div key={t} className="mono" style={{ padding: "5px 0", fontSize: 11.5, color: "var(--foreground-muted)" }}>
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>
    </ExSection>
  );
}

function Bubble({ who, text, diff }) {
  const isAgent = who === "agent";
  return (
    <div style={{ alignSelf: isAgent ? "flex-start" : "flex-end", maxWidth: "82%", display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          padding: "8px 12px",
          border: "1px solid",
          borderColor: isAgent ? "color-mix(in srgb, var(--pillar-autopilot) 28%, transparent)" : "var(--border-subtle)",
          background: isAgent ? "color-mix(in srgb, var(--pillar-autopilot) 8%, transparent)" : "var(--surface-mid)",
          color: "var(--foreground)",
          fontSize: 13,
          lineHeight: 1.55,
          borderRadius: 10,
        }}
      >
        {text}
      </div>
      {diff && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, display: "flex", flexDirection: "column", gap: 2, padding: "2px 6px" }}>
          {diff.map((d, i) => (
            <span key={i} style={{ color: d.startsWith("+") ? "var(--success)" : d.startsWith("~") ? "#f2ca72" : "var(--foreground-subtle)" }}>{d}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Mount section into design system page ---------- */
function ExtrasIndex() {
  return (
    <>
      <InputsFull />
      <SelectsSection />
      <CardsMore />
      <SidebarLayout />
      <IssueDetailLayout />
      <ChatLayout />
    </>
  );
}

Object.assign(window, { ExtrasIndex });
