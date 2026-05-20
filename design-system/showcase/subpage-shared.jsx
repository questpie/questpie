/* subpage-shared.jsx — Nav + Footer + ThemeToggle shared across index + subpages */

const USE_CASE_LINKS = [
  { label: "Restaurants & cafés", href: "index.html#uc-restaurants", icon: "store" },
  { label: "E-commerce & retail", href: "index.html#uc-ecommerce", icon: "store" },
  { label: "Agencies & studios", href: "index.html#uc-agencies", icon: "users" },
  { label: "Real estate", href: "index.html#uc-realestate", icon: "globe" },
  { label: "Portfolios", href: "index.html#uc-portfolios", icon: "pencil" },
];

const NAV_ITEMS = [
  { key: "framework", label: "Framework", href: "index.html#framework" },
  { key: "cloud", label: "Cloud", href: "cloud.html" },
  { key: "autopilot", label: "Autopilot", href: "autopilot.html" },
  { key: "use-cases", label: "Use cases", href: "index.html#use-cases", dropdown: USE_CASE_LINKS },
  { key: "pricing", label: "Pricing", href: "index.html#pricing" },
  { key: "docs", label: "Docs", href: "index.html#docs" },
];

/* ---------- Helper: smart anchor that scrolls in-page ---------- */
function isCurrentPage(href) {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(href, window.location.href);
    return url.pathname === window.location.pathname;
  } catch {
    return false;
  }
}

function navigate(href, e) {
  if (!isCurrentPage(href)) return; // let browser handle cross-page
  const url = new URL(href, window.location.href);
  if (!url.hash) return;
  e?.preventDefault?.();
  const el = document.getElementById(url.hash.slice(1));
  if (el) {
    const top = el.getBoundingClientRect().top + window.scrollY - 70;
    window.scrollTo({ top, behavior: "smooth" });
    history.pushState(null, "", url.hash);
  }
}

/* ---------- Theme toggle ---------- */
function ThemeToggle() {
  const [theme, setTheme] = React.useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("light")
      ? "light"
      : "dark"
  );
  React.useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
      aria-label="Toggle theme"
      style={{ width: 32, padding: 0 }}
    >
      <window.Icon name={theme === "light" ? "moon" : "sun"} size={14} />
    </button>
  );
}

/* ---------- Shared Nav ----------
 * Props:
 *   activeKey?: highlights the matching nav item (e.g. "cloud" on cloud.html)
 */
function SharedNav({ activeKey }) {
  const [scrolled, setScrolled] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      style={{
        position: "fixed",
        inset: "0 0 auto 0",
        zIndex: 50,
        height: 56,
        backdropFilter: scrolled ? "blur(14px) saturate(1.05)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(14px) saturate(1.05)" : "none",
        background: scrolled
          ? "color-mix(in srgb, var(--background) 78%, transparent)"
          : "transparent",
        borderBottom: scrolled
          ? "1px solid var(--border-subtle)"
          : "1px solid transparent",
        transition:
          "background-color var(--motion-base) var(--ease-standard), border-color var(--motion-base) var(--ease-standard)",
      }}
    >
      <div
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          gap: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28, minWidth: 0 }}>
          <a
            href="index.html"
            onClick={(e) => navigate("index.html", e)}
            style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}
          >
            <window.Wordmark size={20} />
          </a>

          <div
            className="nav-links"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              color: "var(--foreground-muted)",
              fontSize: 14,
            }}
          >
            {NAV_ITEMS.map((item) => (
              <NavItem key={item.key} item={item} active={activeKey === item.key} />
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <a
            className="btn btn-ghost btn-sm hide-md"
            href="https://github.com/questpie/questpie"
            target="_blank"
            rel="noreferrer"
            style={{ gap: 6 }}
          >
            <window.Icon name="github" size={14} />
            <span>GitHub</span>
            <span className="mono tabular" style={{ color: "var(--foreground-subtle)", fontSize: 11 }}>
              2.4k
            </span>
          </a>
          <ThemeToggle />
          <a
            className="btn btn-primary btn-sm hide-sm"
            href="index.html#docs"
            onClick={(e) => navigate("index.html#docs", e)}
          >
            Start free
            <window.Icon name="arrowRight" size={13} />
          </a>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="btn btn-ghost btn-sm show-sm"
            aria-label="Toggle navigation"
            style={{ width: 32, padding: 0, display: "none" }}
          >
            <window.Icon name={mobileOpen ? "x" : "menu"} size={16} />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div
          style={{
            position: "absolute",
            inset: "100% 0 auto 0",
            background: "var(--background)",
            borderBottom: "1px solid var(--border-subtle)",
            padding: "12px 24px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {NAV_ITEMS.map((item) => (
            <a
              key={item.key}
              href={item.href}
              onClick={(e) => {
                setMobileOpen(false);
                navigate(item.href, e);
              }}
              style={{
                padding: "10px 12px",
                color: activeKey === item.key ? "var(--foreground)" : "var(--foreground-muted)",
                fontSize: 14,
                fontWeight: activeKey === item.key ? 500 : 400,
                borderRadius: "var(--radius-control-inner)",
              }}
            >
              {item.label}
            </a>
          ))}
        </div>
      )}

      <style>{`
        @media (max-width: 980px) {
          .nav-links { display: none !important; }
          .show-sm { display: inline-flex !important; }
        }
        @media (max-width: 720px) {
          .hide-md { display: none !important; }
          .hide-sm { display: none !important; }
        }
      `}</style>
    </header>
  );
}

function NavItem({ item, active }) {
  if (item.dropdown) {
    return (
      <div className="nav-dropdown" style={{ position: "relative" }}>
        <button
          type="button"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "8px 10px",
            color: active ? "var(--foreground)" : "var(--foreground-muted)",
            borderRadius: "var(--radius-control-inner)",
            fontSize: 14,
            fontWeight: active ? 500 : 400,
            transition: "color var(--motion-base) var(--ease-standard)",
          }}
        >
          {item.label}
          <window.Icon name="caretDown" size={10} />
        </button>
        <div
          className="dropdown-panel"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            paddingTop: 8,
            opacity: 0,
            pointerEvents: "none",
            transition: "opacity var(--motion-base) var(--ease-standard)",
          }}
        >
          <div
            style={{
              minWidth: 240,
              background: "var(--popover)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-floating)",
              boxShadow: "var(--floating-shadow)",
              padding: 6,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {item.dropdown.map((d) => (
              <a
                key={d.label}
                href={d.href}
                onClick={(e) => navigate(d.href, e)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: "var(--radius-control-inner)",
                  color: "var(--foreground)",
                  fontSize: 13,
                  transition: "background-color var(--motion-base) var(--ease-standard)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-mid)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <window.Icon name={d.icon} size={14} stroke={1.6} style={{ color: "var(--foreground-subtle)" }} />
                {d.label}
              </a>
            ))}
          </div>
        </div>
        <style>{`
          .nav-dropdown:hover .dropdown-panel { opacity: 1; pointer-events: auto; }
          .nav-dropdown:hover > button { color: var(--foreground); }
        `}</style>
      </div>
    );
  }
  return (
    <a
      href={item.href}
      onClick={(e) => navigate(item.href, e)}
      style={{
        position: "relative",
        padding: "8px 10px",
        color: active ? "var(--foreground)" : "var(--foreground-muted)",
        fontWeight: active ? 500 : 400,
        borderRadius: "var(--radius-control-inner)",
        fontSize: 14,
        transition: "color var(--motion-base) var(--ease-standard)",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.color = "var(--foreground)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.color = "var(--foreground-muted)";
      }}
    >
      {item.label}
      {active && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 10,
            right: 10,
            bottom: 2,
            height: 2,
            background: "var(--primary)",
            borderRadius: 1,
          }}
        />
      )}
    </a>
  );
}

/* ---------- Shared Footer ---------- */
const FOOTER_USE_CASES = [
  ["Restaurants & cafés", "index.html#uc-restaurants"],
  ["E-commerce & retail", "index.html#uc-ecommerce"],
  ["Agencies & studios", "index.html#uc-agencies"],
  ["Real estate", "index.html#uc-realestate"],
  ["Portfolios", "index.html#uc-portfolios"],
];

function SharedFooter() {
  const cols = [
    {
      title: "Product",
      items: [
        ["Framework", "index.html#framework"],
        ["Cloud", "cloud.html"],
        ["Autopilot", "autopilot.html"],
        ["Pricing", "index.html#pricing"],
        ["Changelog", "#"],
      ],
    },
    { title: "Use cases", items: FOOTER_USE_CASES },
    {
      title: "Resources",
      items: [
        ["Documentation", "index.html#docs"],
        ["Examples", "#"],
        ["Templates", "#"],
        ["MCP reference", "#"],
        ["RFCs", "#"],
      ],
    },
    {
      title: "Company",
      items: [
        ["GitHub", "https://github.com/questpie/questpie"],
        ["Blog", "#"],
        ["Brand kit", "#"],
        ["Status", "#"],
        ["Contact", "#contact"],
      ],
    },
  ];
  return (
    <footer
      style={{
        borderTop: "1px solid var(--border-subtle)",
        padding: "56px 24px 32px",
        background: "var(--surface)",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div
          className="footer-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.2fr) repeat(4, minmax(0, 1fr))",
            gap: 28,
            marginBottom: 36,
          }}
        >
          <div>
            <window.Wordmark size={22} />
            <p
              className="balance"
              style={{
                marginTop: 14,
                fontSize: 13,
                color: "var(--foreground-muted)",
                lineHeight: 1.6,
                maxWidth: 260,
              }}
            >
              One open-source platform for your site, your operations and your
              infrastructure. Self-host free, or let Cloud run it for you.
            </p>
            <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
              <a
                className="btn btn-secondary btn-sm"
                href="https://github.com/questpie/questpie"
                target="_blank"
                rel="noreferrer"
              >
                <window.Icon name="github" size={13} />
                GitHub
              </a>
              <a className="btn btn-ghost btn-sm" href="#">
                <window.Icon name="chat" size={13} />
                Discord
              </a>
            </div>
          </div>

          {cols.map((c) => (
            <div key={c.title}>
              <div className="eyebrow" style={{ marginBottom: 12 }}>{c.title}</div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {c.items.map(([label, href]) => (
                  <li key={label}>
                    <a
                      href={href}
                      onClick={(e) => navigate(href, e)}
                      style={{
                        fontSize: 13,
                        color: "var(--foreground-muted)",
                        transition: "color var(--motion-base) var(--ease-standard)",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--foreground)")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--foreground-muted)")}
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          style={{
            borderTop: "1px solid var(--border-subtle)",
            paddingTop: 18,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            fontSize: 12,
            color: "var(--foreground-subtle)",
          }}
        >
          <span className="mono">© 2026 QUESTPIE · MIT · Made in Bratislava</span>
          <span style={{ display: "inline-flex", gap: 14 }}>
            <a href="#" style={{ color: "inherit" }}>Privacy</a>
            <a href="#" style={{ color: "inherit" }}>Terms</a>
            <a href="#" style={{ color: "inherit" }}>Security</a>
            <a href="#" style={{ color: "inherit" }}>Status</a>
          </span>
        </div>
      </div>

      <style>{`
        @media (max-width: 880px) { .footer-grid { grid-template-columns: 1fr 1fr !important; } }
        @media (max-width: 540px) { .footer-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </footer>
  );
}

Object.assign(window, { SharedNav, SharedFooter, ThemeToggle, navigate });
