import { CheckCircle, FileText, Plus, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import {
  coldarkCold,
  coldarkDark,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";

SyntaxHighlighter.registerLanguage("typescript", typescript);

// Step 1: Define your collection schema
const schemaCode = `// server/collections/posts.ts
const posts = qb.collection('posts')
  .fields((f) => ({
    title: f.text({ required: true }),
    content: f.richText(),
    status: f.select({
      options: ['draft', 'published'],
    }),
  }))`;

// Step 2: Auto-generated endpoints
const endpointsCode = `// Auto-generated REST API
GET    /api/cms/posts
GET    /api/cms/posts/:id
POST   /api/cms/posts
PATCH  /api/cms/posts/:id
DELETE /api/cms/posts/:id

// Type-safe SDK
const { docs } = await client.collections.posts.find({
  where: { status: 'published' }
})`;

// Step 3: Chain admin config (same file)
const adminCode = `// server/collections/posts.ts (continued)
posts
  .admin(({ c }) => ({
    label: 'Posts',
    icon: c.icon('ph:article'),
  }))
  .list(({ v, f }) => v.table({
    columns: [f.title, f.status],
    searchable: ['title'],
  }))
  .form(({ v, f }) => v.form({
    fields: [f.title, f.content, f.status],
  }))`;

type Phase =
  | "schema"
  | "schema-done"
  | "endpoints"
  | "endpoints-done"
  | "admin"
  | "result";

export function HeroVisual() {
  const [phase, setPhase] = useState<Phase>("schema");
  const [displayedCode, setDisplayedCode] = useState("");
  const [showTable, setShowTable] = useState(false);
  const displayedCodeRef = useRef("");

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    const delay = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const id = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => {
          clearTimeout(id);
          reject(new Error("aborted"));
        });
      });

    const typeCode = async (code: string) => {
      while (!signal.aborted && displayedCodeRef.current !== code) {
        const nextStr = code.slice(0, displayedCodeRef.current.length + 1);
        displayedCodeRef.current = nextStr;
        setDisplayedCode(nextStr);
        await delay(30);
      }
    };

    const loop = async () => {
      try {
        await delay(800);

        while (!signal.aborted) {
          // Phase 1: Schema definition
          setPhase("schema");
          setShowTable(false);
          displayedCodeRef.current = "";
          setDisplayedCode("");

          await typeCode(schemaCode);
          if (signal.aborted) break;

          setPhase("schema-done");
          await delay(1500);

          // Phase 2: Auto-generated endpoints
          setPhase("endpoints");
          displayedCodeRef.current = "";
          setDisplayedCode("");

          await typeCode(endpointsCode);
          if (signal.aborted) break;

          setPhase("endpoints-done");
          await delay(1500);

          // Phase 3: Admin config
          setPhase("admin");
          displayedCodeRef.current = "";
          setDisplayedCode("");

          await typeCode(adminCode);
          if (signal.aborted) break;

          // Phase 4: Result
          setPhase("result");
          await delay(400);
          setShowTable(true);

          await delay(4000);
        }
      } catch {
        // Aborted, ignore
      }
    };

    loop();
    return () => {
      controller.abort();
    };
  }, []);

  const isTyping =
    phase === "schema" || phase === "endpoints" || phase === "admin";
  const showCode = phase !== "result";

  return (
    <div className="relative">
      {/* Glow */}
      <div className="absolute -inset-4 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent rounded-3xl blur-2xl" />

      {/* Main card */}
      <div className="relative rounded-2xl border border-border bg-background/95 backdrop-blur-sm overflow-hidden shadow-2xl">
        {/* Code view */}
        <div
          className={cn(
            "transition-all duration-500",
            showCode
              ? "opacity-100"
              : "opacity-0 absolute inset-0 pointer-events-none",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/50" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                <div className="w-3 h-3 rounded-full bg-green-500/50" />
              </div>
              <span className="text-xs text-muted-foreground font-mono ml-2">
                {phase === "schema" || phase === "schema-done"
                  ? "server/posts.ts"
                  : phase === "endpoints" || phase === "endpoints-done"
                    ? "Generated API"
                    : "server/posts.ts"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {isTyping ? (
                <>
                  <Sparkles className="w-3 h-3 text-primary animate-pulse" />
                  <span className="text-xs text-primary font-mono">
                    Writing...
                  </span>
                </>
              ) : phase === "schema-done" || phase === "endpoints-done" ? (
                <>
                  <CheckCircle className="w-3 h-3 text-green-500" />
                  <span className="text-xs text-green-500 font-mono">
                    Ready
                  </span>
                </>
              ) : null}
            </div>
          </div>

          {/* Code */}
          <div className="p-4 min-h-[280px] relative">
            {/* Light mode */}
            <div className="dark:hidden">
              <SyntaxHighlighter
                language="typescript"
                style={coldarkCold}
                customStyle={{
                  background: "transparent",
                  padding: 0,
                  margin: 0,
                  fontSize: "0.8125rem",
                  lineHeight: "1.6",
                }}
                showLineNumbers={true}
                wrapLines={true}
              >
                {displayedCode || " "}
              </SyntaxHighlighter>
            </div>
            {/* Dark mode */}
            <div className="hidden dark:block">
              <SyntaxHighlighter
                language="typescript"
                style={coldarkDark}
                customStyle={{
                  background: "transparent",
                  padding: 0,
                  margin: 0,
                  fontSize: "0.8125rem",
                  lineHeight: "1.6",
                }}
                showLineNumbers={true}
                wrapLines={true}
              >
                {displayedCode || " "}
              </SyntaxHighlighter>
            </div>
            {/* Typing cursor */}
            {isTyping && (
              <span
                className="absolute inline-block w-2 h-4 bg-primary animate-pulse"
                style={{ marginLeft: "2px" }}
              />
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-border bg-muted/30">
            <span className="font-mono text-xs text-primary">
              {phase === "schema" || phase === "schema-done"
                ? "Step 1 — Define Schema"
                : phase === "endpoints" || phase === "endpoints-done"
                  ? "Step 2 — API Ready"
                  : "Step 3 — Chain Admin Config"}
            </span>
          </div>
        </div>

        {/* Admin panel view */}
        <div
          className={cn(
            "transition-all duration-500",
            !showCode
              ? "opacity-100"
              : "opacity-0 absolute inset-0 pointer-events-none",
          )}
        >
          {/* Title bar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/50">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            <span className="text-xs text-muted-foreground font-mono ml-2">
              localhost:3000/admin/posts
            </span>
          </div>

          {/* Main content with sidebar */}
          <div className="flex min-h-[280px]">
            {/* Sidebar */}
            <div className="w-36 border-r border-border p-2 bg-muted/30 hidden sm:block">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground rounded">
                  <div className="w-3.5 h-3.5 bg-muted rounded" />
                  Dashboard
                </div>
                <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium bg-primary/10 text-primary rounded">
                  <FileText className="w-3.5 h-3.5" />
                  Posts
                </div>
                <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground rounded">
                  <div className="w-3.5 h-3.5 bg-muted rounded" />
                  Authors
                </div>
                <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground rounded">
                  <div className="w-3.5 h-3.5 bg-muted rounded" />
                  Settings
                </div>
              </div>
            </div>

            {/* Main area */}
            <div className="flex-1 p-3">
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm">Posts</span>
                </div>
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-primary text-primary-foreground text-xs font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New
                </button>
              </div>

              {/* Search bar */}
              <div className="flex gap-2 mb-3">
                <div className="flex-1 h-7 bg-muted/50 border border-border px-2 flex items-center">
                  <span className="text-xs text-muted-foreground">
                    Search posts...
                  </span>
                </div>
                <div className="h-7 px-2 bg-muted/50 border border-border flex items-center">
                  <span className="text-xs text-muted-foreground">Options</span>
                </div>
              </div>

              {/* Table */}
              <div className="border border-border overflow-hidden">
                <div className="grid grid-cols-[20px_1fr_80px_70px] gap-2 px-2.5 py-1.5 bg-muted/50 text-[10px] font-medium text-muted-foreground border-b border-border uppercase tracking-wider">
                  <div />
                  <div>Title</div>
                  <div>Status</div>
                  <div>Updated</div>
                </div>
                {[
                  {
                    title: "Getting Started Guide",
                    status: "published",
                    time: "2h ago",
                  },
                  {
                    title: "API Documentation",
                    status: "draft",
                    time: "5h ago",
                  },
                  {
                    title: "Deployment Tips",
                    status: "published",
                    time: "1d ago",
                  },
                  { title: "Best Practices", status: "review", time: "2d ago" },
                ].map((post, i) => (
                  <div
                    key={post.title}
                    className={cn(
                      "grid grid-cols-[20px_1fr_80px_70px] gap-2 px-2.5 py-2 text-xs border-b border-border last:border-0 hover:bg-muted/30 transition-all duration-300",
                      showTable
                        ? "opacity-100 translate-x-0"
                        : "opacity-0 translate-x-4",
                    )}
                    style={{
                      transitionDelay: showTable ? `${i * 75}ms` : "0ms",
                    }}
                  >
                    <div className="flex items-center">
                      <div className="w-3.5 h-3.5 border border-border rounded-sm bg-background" />
                    </div>
                    <div className="truncate font-medium">{post.title}</div>
                    <div>
                      <StatusBadge status={post.status} />
                    </div>
                    <div className="text-muted-foreground">{post.time}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-border bg-muted/20">
            <span className="text-[10px] text-muted-foreground font-mono">
              Showing 4 of 4 posts
            </span>
          </div>
        </div>
      </div>

      {/* Step indicator */}
      <div className="mt-4 flex justify-center gap-1.5">
        {["Schema", "API", "Admin", "Result"].map((step, i) => {
          const stepPhases = [
            ["schema", "schema-done"],
            ["endpoints", "endpoints-done"],
            ["admin"],
            ["result"],
          ];
          const isActive = stepPhases[i].includes(phase);
          const isDone = i < stepPhases.findIndex((p) => p.includes(phase));

          return (
            <div key={step} className="flex items-center gap-1.5">
              <div
                className={cn(
                  "w-2 h-2 rounded-full transition-all",
                  isActive
                    ? "bg-primary scale-125"
                    : isDone
                      ? "bg-primary/50"
                      : "bg-muted",
                )}
              />
              <span
                className={cn(
                  "text-xs transition-colors",
                  isActive
                    ? "text-primary font-medium"
                    : "text-muted-foreground",
                )}
              >
                {step}
              </span>
              {i < 3 && (
                <span className="text-muted-foreground mx-0.5">&rarr;</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    published: {
      bg: "bg-green-500/10",
      text: "text-green-600 dark:text-green-400",
      dot: "bg-green-500",
    },
    draft: {
      bg: "bg-yellow-500/10",
      text: "text-yellow-600 dark:text-yellow-400",
      dot: "bg-yellow-500",
    },
    review: {
      bg: "bg-blue-500/10",
      text: "text-blue-600 dark:text-blue-400",
      dot: "bg-blue-500",
    },
  };
  const style = config[status as keyof typeof config];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
        style.bg,
        style.text,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", style.dot)} />
      {status}
    </span>
  );
}
