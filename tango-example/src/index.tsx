import { useState, useEffect, useMemo } from "react";
import {
  defineReactInstrument,
  useInstrumentApi,
  useHostEvent,
  useSession,
  UIRoot,
  UISection,
  UICard,
  UIList,
  UIListItem,
  UIButton,
  UIInput,
  UITextarea,
  UIDropdown,
  UIToggle,
  UICheckbox,
  UIRadioGroup,
  UISegmentedControl,
  UIBadge,
  UITabs,
  UIGroup,
  UIGroupList,
  UIGroupItem,
  UIGroupEmpty,
  UIMarkdownRenderer,
  UIDiffRenderer,
  useDiffSelection,
  useDiffComments,
  parseDiff,
} from "tango-api";
import type { DiffFile, DiffViewMode } from "tango-api";

// --- Feature registry ---

type Feature = {
  id: string;
  title: string;
  subtitle: string;
};

const FEATURES: Feature[] = [
  { id: "background", title: "Background Process", subtitle: "Lifecycle & background refresh demo" },
  { id: "diff", title: "Diff", subtitle: "UIDiffRenderer with selection and comments" },
  { id: "ui-components", title: "UI Components", subtitle: "Buttons, inputs, toggles, and more" },
  { id: "ai", title: "AI", subtitle: "Query AI without creating a session" },
  { id: "markdown", title: "Markdown", subtitle: "Render markdown with UIMarkdownRenderer" },
];

// --- Shared state (module-level, both panels share the same JS bundle) ---

let sharedFeatureId: string | null = null;
const listeners: Set<() => void> = new Set();

function setSharedFeatureId(id: string) {
  sharedFeatureId = id;
  listeners.forEach((fn) => fn());
}

function useSharedFeatureId() {
  const [featureId, setFeatureId] = useState(sharedFeatureId);
  useEffect(() => {
    const handler = () => setFeatureId(sharedFeatureId);
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);
  return featureId;
}

// --- Shared log (module-level pub/sub) ---

type LogEntry = { time: string; message: string };

const logEntries: LogEntry[] = [];
const logListeners: Set<() => void> = new Set();

function log(message: string) {
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  logEntries.push({ time, message });
  if (logEntries.length > 50) logEntries.shift();
  logListeners.forEach((fn) => fn());
}

function clearLog() {
  logEntries.length = 0;
  logListeners.forEach((fn) => fn());
}

function useLog() {
  const [entries, setEntries] = useState<LogEntry[]>([...logEntries]);
  useEffect(() => {
    const handler = () => setEntries([...logEntries]);
    logListeners.add(handler);
    return () => { logListeners.delete(handler); };
  }, []);
  return entries;
}

// --- Global styles ---

const CUSTOM_STYLES = `
.padded { padding: 12px; }
.padded hr { border: none; border-top: 1px solid var(--tui-border, #333); margin: 4px 0; }
.log-panel { border: 1px solid var(--tui-border, #333); border-radius: 6px; background: var(--tui-bg-secondary, #181818); padding: 8px; max-height: 200px; overflow-y: auto; font-family: monospace; font-size: 11px; }
.log-entry { display: flex; gap: 6px; padding: 2px 0; border-bottom: 1px solid var(--tui-border, #333); }
.log-entry:last-child { border-bottom: none; }
.log-time { color: var(--tui-text-secondary, #9ca3af); white-space: nowrap; }
.log-msg { color: var(--tui-text, #e5e7eb); word-break: break-word; }

`;

// --- Sidebar Panel ---

function LogPanel() {
  const entries = useLog();
  return (
    <div className="log-panel">
      {entries.length === 0 && (
        <span style={{ opacity: 0.4 }}>No logs yet.</span>
      )}
      {entries.map((e, i) => (
        <div className="log-entry" key={i}>
          <span className="log-time">{e.time}</span>
          <span className="log-msg">{e.message}</span>
        </div>
      ))}
    </div>
  );
}

function SidebarPanel() {
  const [activeId, setActiveId] = useState<string | null>(null);

  function selectFeature(id: string) {
    setActiveId(id);
    setSharedFeatureId(id);
    log(`Selected feature: ${id}`);
  }

  return (
    <UIRoot className="padded"><style>{CUSTOM_STYLES}</style>
      <UISection title="Features">
        <UIList>
          {FEATURES.map((f) => (
            <UIListItem
              key={f.id}
              title={f.title}
              subtitle={f.subtitle}
              active={activeId === f.id}
              onClick={() => selectFeature(f.id)}
            />
          ))}
        </UIList>
      </UISection>
      <hr />
      <UISection>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="tui-section-title">Log</span>
          <UIButton label="Clear" variant="ghost" size="sm" onClick={clearLog} />
        </div>
        <LogPanel />
      </UISection>
    </UIRoot>
  );
}

// --- Feature: UI Components ---

function UIComponentsDemo() {
  const [inputValue, setInputValue] = useState("");
  const [textareaValue, setTextareaValue] = useState("");
  const [dropdownValue, setDropdownValue] = useState("");
  const [toggleValue, setToggleValue] = useState(false);
  const [checkboxValue, setCheckboxValue] = useState(false);
  const [radioValue, setRadioValue] = useState("a");
  const [segmentValue, setSegmentValue] = useState("one");
  const [group1Expanded, setGroup1Expanded] = useState(true);
  const [group2Expanded, setGroup2Expanded] = useState(false);
  const [group3Expanded, setGroup3Expanded] = useState(false);

  return (
    <>
      <UISection>
        <h3>Buttons</h3>
        <UICard>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <UIButton label="Primary" variant="primary" onClick={() => log("Button clicked: Primary")} />
            <UIButton label="Primary + Icon" variant="primary" icon="ai" onClick={() => log("Button clicked: Primary + Icon")} />
            <UIButton label="Secondary" variant="secondary" onClick={() => log("Button clicked: Secondary")} />
            <UIButton label="Ghost" variant="ghost" onClick={() => log("Button clicked: Ghost")} />
            <UIButton label="Danger" variant="danger" onClick={() => log("Button clicked: Danger")} />
            <UIButton label="Disabled" disabled />
          </div>
        </UICard>
      </UISection>

      <UISection>
        <hr /><h3>Badges</h3>
        <UICard>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <UIBadge label="Neutral" tone="neutral" />
            <UIBadge label="Info" tone="info" />
            <UIBadge label="Success" tone="success" />
            <UIBadge label="Warning" tone="warning" />
            <UIBadge label="Danger" tone="danger" />
          </div>
        </UICard>
      </UISection>

      <UISection>
        <hr /><h3>Input</h3>
        <UICard>
          <UIInput
            value={inputValue}
            placeholder="Type something..."
            onInput={(v) => { setInputValue(v); log(`Input changed: "${v}"`); }}
          />
          <p style={{ marginTop: 4, opacity: 0.6, fontSize: 12 }}>
            Value: {inputValue || "(empty)"}
          </p>
        </UICard>
      </UISection>

      <UISection>
        <hr /><h3>Textarea</h3>
        <UICard>
          <UITextarea
            value={textareaValue}
            placeholder="Write a longer text..."
            rows={3}
            onInput={(v) => { setTextareaValue(v); log(`Textarea changed`); }}
          />
        </UICard>
      </UISection>

      <UISection>
        <hr /><h3>Dropdown</h3>
        <UICard>
          <UIDropdown
            placeholder="Pick an option..."
            options={[
              { value: "option1", label: "Option 1" },
              { value: "option2", label: "Option 2" },
              { value: "option3", label: "Option 3" },
            ]}
            onChange={(v) => { setDropdownValue(v); log(`Dropdown changed: ${v}`); }}
          />
          <p style={{ marginTop: 4, opacity: 0.6, fontSize: 12 }}>
            Selected: {dropdownValue || "(none)"}
          </p>
        </UICard>
      </UISection>



      <UISection>
        <hr /><h3>Toggle</h3>
        <UICard>
          <UIToggle
            label="Enable feature"
            checked={toggleValue}
            onChange={(v) => { setToggleValue(v); log(`Toggle: ${v ? "on" : "off"}`); }}
          />
        </UICard>
      </UISection>

      <UISection>
        <hr /><h3>Checkbox</h3>
        <UICard>
          <UICheckbox
            label="I agree to the terms"
            checked={checkboxValue}
            onChange={(v) => { setCheckboxValue(v); log(`Checkbox: ${v ? "checked" : "unchecked"}`); }}
          />
        </UICard>
      </UISection>

      <UISection>
        <hr /><h3>Radio Group</h3>
        <UICard>
          <UIRadioGroup
            name="demo-radio"
            value={radioValue}
            options={[
              { value: "a", label: "Option A" },
              { value: "b", label: "Option B" },
              { value: "c", label: "Option C" },
            ]}
            onChange={(v) => { setRadioValue(v); log(`Radio selected: ${v}`); }}
          />
        </UICard>
      </UISection>

      <UISection>
        <hr /><h3>Segmented Control</h3>
        <UICard>
          <UISegmentedControl
            value={segmentValue}
            options={[
              { value: "one", label: "One" },
              { value: "two", label: "Two" },
              { value: "three", label: "Three" },
            ]}
            onChange={(v) => { setSegmentValue(v); log(`Segment selected: ${v}`); }}
          />
        </UICard>
      </UISection>

      <UISection>
        <hr /><h3>Group</h3>
        <UICard>
          <UIGroupList>
            <UIGroup
              title="Active Tasks"
              subtitle="3 items"
              expanded={group1Expanded}
              onToggle={(v) => { setGroup1Expanded(v); log(`Group "Active Tasks": ${v ? "expanded" : "collapsed"}`); }}
            >
              <UIGroupItem title="Implement login" subtitle="In progress" onClick={() => log("Clicked: Implement login")} />
              <UIGroupItem title="Fix header bug" subtitle="Review" onClick={() => log("Clicked: Fix header bug")} />
              <UIGroupItem title="Update docs" subtitle="Todo" onClick={() => log("Clicked: Update docs")} />
            </UIGroup>
            <UIGroup
              title="Completed"
              subtitle="2 items"
              expanded={group2Expanded}
              onToggle={(v) => { setGroup2Expanded(v); log(`Group "Completed": ${v ? "expanded" : "collapsed"}`); }}
            >
              <UIGroupItem title="Setup CI" subtitle="Done" />
              <UIGroupItem title="Add tests" subtitle="Done" />
            </UIGroup>
            <UIGroup
              title="Backlog"
              subtitle="Empty"
              expanded={group3Expanded}
              onToggle={(v) => { setGroup3Expanded(v); log(`Group "Backlog": ${v ? "expanded" : "collapsed"}`); }}
            >
              <UIGroupEmpty text="No items in backlog" />
            </UIGroup>
          </UIGroupList>
        </UICard>
      </UISection>

      <UISection>
        <hr /><h3>Tabs</h3>
        <UICard>
          <UITabs
            tabs={[
              { value: "tab1", label: "First", content: <p>Content of the first tab.</p> },
              { value: "tab2", label: "Second", content: <p>Content of the second tab.</p> },
              { value: "tab3", label: "Third", content: <p>Content of the third tab.</p> },
            ]}
            onChange={(v) => log(`Tab selected: ${v}`)}
          />
        </UICard>
      </UISection>

    </>
  );
}

// --- Feature: Background Process ---

function BackgroundProcessDemo() {
  const api = useInstrumentApi();
  const [status, setStatus] = useState<string>("loading...");
  const [tickCount, setTickCount] = useState<number>(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [bgEvents, setBgEvents] = useState<Array<{ tick: number; time: string }>>([]);

  async function fetchState() {
    try {
      const result = await api.actions.call<{}, {
        status: string;
        startedAt: string | null;
        tickCount: number;
        lastRefreshedAt: string | null;
      }>("getLifecycleState", {});
      setStatus(result.status);
      setTickCount(result.tickCount);
      setLastRefreshedAt(result.lastRefreshedAt);
      setStartedAt(result.startedAt);
      log(`Lifecycle state: ${result.status}, ticks: ${result.tickCount}`);
    } catch (err: any) {
      setStatus(`error: ${err.message}`);
      log(`Failed to fetch lifecycle state: ${err.message}`);
    }
  }

  useEffect(() => {
    fetchState();
  }, []);

  // Listen for background tick events (only received while this panel is mounted)
  useHostEvent("instrument.event", (payload: any) => {
    if (payload.event === "bg.tick") {
      const { tickCount: tick, refreshedAt } = payload.payload;
      setTickCount(tick);
      setLastRefreshedAt(refreshedAt);
      setBgEvents((prev) => {
        const next = [...prev, { tick, time: new Date(refreshedAt).toLocaleTimeString("en-US", { hour12: false }) }];
        return next.slice(-20); // keep last 20
      });
      log(`Background tick #${tick} received`);
    }
  });

  async function handleReset() {
    await api.actions.call("resetTicks", {});
    setTickCount(0);
    setLastRefreshedAt(null);
    setBgEvents([]);
    log("Ticks reset");
  }

  function formatTime(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  return (
    <>
      <UISection title="Instrument Lifecycle">
        <UICard>
          <p style={{ fontSize: 12, opacity: 0.6, lineHeight: 1.6, marginBottom: 12 }}>
            This demonstrates the <strong>background refresh</strong> lifecycle. When you navigate
            away from this instrument, the backend calls <code>onStop()</code> and enters a
            suspended state. Every 10 seconds, <code>onBackgroundRefresh()</code> runs with a
            restricted context — it can only access storage, settings, emit, and logger.
            When you return, <code>onStart()</code> resumes the full backend.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", fontSize: 13 }}>
            <span style={{ opacity: 0.6 }}>Status</span>
            <UIBadge label={status} tone={status === "active" ? "success" : status === "suspended" ? "warning" : "neutral"} />
            <span style={{ opacity: 0.6 }}>Started at</span>
            <span>{formatTime(startedAt)}</span>
            <span style={{ opacity: 0.6 }}>Background ticks</span>
            <span style={{ fontWeight: 600 }}>{tickCount}</span>
            <span style={{ opacity: 0.6 }}>Last refresh</span>
            <span>{formatTime(lastRefreshedAt)}</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <UIButton label="Refresh" variant="secondary" size="sm" onClick={fetchState} />
            <UIButton label="Reset Ticks" variant="ghost" size="sm" onClick={handleReset} />
          </div>
        </UICard>
      </UISection>

      <UISection title="How to Test">
        <UICard>
          <ol style={{ fontSize: 12, lineHeight: 1.8, opacity: 0.7, paddingLeft: 16, margin: 0 }}>
            <li>Note the current tick count above</li>
            <li>Navigate to another instrument (e.g., PRs or Music)</li>
            <li>Wait 20-30 seconds</li>
            <li>Come back — tick count should have increased</li>
            <li>The <code>onStop → onBackgroundRefresh → onStart</code> cycle is logged below</li>
          </ol>
        </UICard>
      </UISection>

      {bgEvents.length > 0 && (
        <UISection title="Live Background Events">
          <UICard>
            <div className="log-panel">
              {bgEvents.map((e, i) => (
                <div className="log-entry" key={i}>
                  <span className="log-time">{e.time}</span>
                  <span className="log-msg">tick #{e.tick}</span>
                </div>
              ))}
            </div>
          </UICard>
        </UISection>
      )}
    </>
  );
}

// --- Feature: AI ---

const SAMPLE_STORY = `The old lighthouse keeper had not spoken to another person in seventeen years. Each evening, he climbed the spiral staircase, lit the lamp, and watched the ships pass in the distance. One night, a small boat appeared on the rocks below. Inside was a child, no older than seven, clutching a waterlogged journal. The keeper carried the child inside, wrapped them in blankets, and for the first time in nearly two decades, said: "You're safe now." The journal, once dried, contained a single repeated phrase in a language he didn't recognize — but the child translated it without hesitation: "Find the keeper of the light."`;

function AIDemo() {
  const api = useInstrumentApi();
  const [story] = useState(SAMPLE_STORY);
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSummarize() {
    setLoading(true);
    setSummary("");
    log("AI query: requesting summary...");
    try {
      const result = await api.sessions.query({
        prompt: `Summarize the following story in 2-3 sentences. Only return the summary, nothing else.\n\n${story}`,
      });
      setSummary(result.text);
      log(`AI query complete (${result.durationMs}ms, $${result.costUsd?.toFixed(4) ?? "?"})`);
    } catch (err: any) {
      setSummary(`Error: ${err.message ?? "unknown error"}`);
      log(`AI query failed: ${err.message ?? "unknown error"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <UISection>
        <h3>Story</h3>
        <UICard>
          <p style={{ lineHeight: 1.5 }}>{story}</p>
        </UICard>
      </UISection>

      <UISection>
        <hr /><h3>Summary</h3>
        <UICard>
          <UIButton
            label={loading ? "Summarizing..." : "Summarize"}
            variant="primary"
            icon="ai"
            disabled={loading}
            onClick={handleSummarize}
          />
          {summary && (
            <p style={{ marginTop: 10, lineHeight: 1.5, opacity: 0.9 }}>{summary}</p>
          )}
        </UICard>
      </UISection>

      <UISection>
        <hr /><h3>Mini Chat</h3>
        <MiniChat />
      </UISection>
    </>
  );
}

// --- Mini Chat (using useSession hook) ---

function MiniChat() {
  const session = useSession({ id: "minichat", persist: true });
  const [input, setInput] = useState("");

  // Log session state changes for debugging
  useEffect(() => {
    if (session.loaded) {
      log(`Chat restored: sid=${session.sessionId?.slice(0, 8) ?? "no"}, user=${session.userMessage ? "yes" : "no"}, ai=${session.response ? "yes" : "no"}`);
    }
  }, [session.loaded]);

  useEffect(() => {
    if (session.isResponding) {
      log("Chat: AI responding...");
    } else if (session.response) {
      log(`Chat: response complete (${session.response.length} chars)`);
    }
  }, [session.isResponding]);

  // Spy on raw stream events to understand what the hook sees
  useHostEvent("session.stream", (payload: any) => {
    const evt = payload.event;
    if (evt.type === "assistant") {
      const textBlocks = (evt.message?.content || []).filter((b: any) => b.type === "text");
      const text = textBlocks.map((b: any) => b.text).join("");
      log(`[spy] assistant: ${text.length} chars, blocks: ${evt.message?.content?.length}`);
    } else if (evt.type === "result") {
      log(`[spy] result: evt.result=${(evt.result || "").length} chars, sid=${payload.sessionId?.slice(0, 8)}`);
    } else {
      log(`[spy] ${evt.type}${evt.subtype ? "." + evt.subtype : ""} sid=${(evt.session_id || payload.sessionId || "?").slice(0, 8)}`);
    }
  });

  if (!session.loaded) return null;

  return (
    <UICard>
      {session.userMessage && (
        <div style={{ padding: "6px 0", borderBottom: "1px solid var(--tui-border, #333)" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--tui-primary, #d97757)" }}>You</span>
          <p style={{ margin: "4px 0 0", lineHeight: 1.4, fontSize: 13 }}>{session.userMessage}</p>
        </div>
      )}
      {session.response && (
        <div style={{ padding: "6px 0", marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--tui-green, #10b981)" }}>AI</span>
          <p style={{ margin: "4px 0 0", lineHeight: 1.4, fontSize: 13 }}>{session.response}</p>
        </div>
      )}
      {session.isResponding && !session.response && (
        <div style={{ padding: "6px 0", marginBottom: 10, opacity: 0.5, fontSize: 12 }}>AI is thinking...</div>
      )}
      {!session.userMessage && !session.isResponding && (
        <p style={{ opacity: 0.4, fontSize: 12, marginBottom: 10 }}>Send a message. The session persists across exchanges.</p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <UIInput
            value={input}
            placeholder="Type a message..."
            onInput={setInput}
          />
        </div>
        <UIButton
          label="Send"
          variant="primary"
          disabled={session.isResponding || !input.trim()}
          onClick={() => { const text = input.trim(); setInput(""); log(`Chat: sending "${text}"`); session.send(text); }}
        />
      </div>
    </UICard>
  );
}

// --- Feature: Markdown ---

const SAMPLE_MARKDOWN = `# Markdown Rendering Demo

This demonstrates the **UIMarkdownRenderer** component from the Tango API.

## Features

- Renders standard **Markdown** into styled HTML
- Supports \`inline code\` and code blocks
- Handles lists, headings, links, and more

## Code Example

\`\`\`typescript
const session = useSession({ id: "chat", persist: true });
session.send("Hello from Tango!");
\`\`\`

## Table

| Feature | Status |
|---------|--------|
| Headings | Supported |
| Bold/Italic | Supported |
| Code blocks | Supported |
| Tables | Supported |
| Links | Supported |

## Links

- [Tango Documentation](https://docs.tango.dev)
- [GitHub](https://github.com)

## Blockquote

> "The best way to predict the future is to invent it."
> — Alan Kay

---

*Rendered by \`UIMarkdownRenderer\` from \`@tango/api\`*
`;

function MarkdownDemo() {
  const [content, setContent] = useState(SAMPLE_MARKDOWN);
  return (
    <>
      <UISection>
        <h3>Preview</h3>
        <UICard>
          <UIMarkdownRenderer content={content} rawViewEnabled />
        </UICard>
      </UISection>

      <UISection>
        <hr /><h3>Custom Content</h3>
        <UICard>
          <UITextarea
            value={content}
            rows={6}
            placeholder="Write your own markdown..."
            onInput={(v) => { setContent(v); log("Markdown: content updated"); }}
          />
        </UICard>
      </UISection>
    </>
  );
}

// --- Feature: Diff ---

const SAMPLE_DIFF = `diff --git a/src/auth/login.ts b/src/auth/login.ts
index abcdef1..1234567 100644
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -1,15 +1,18 @@
 import { hash } from "./crypto";
 import { db } from "./database";
+import { rateLimit } from "./middleware";

 export async function login(email: string, password: string) {
+  await rateLimit(email);
+
   const user = await db.findUser({ email });
   if (!user) {
-    throw new Error("Invalid credentials");
+    throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
   }

   const valid = await hash.verify(password, user.passwordHash);
   if (!valid) {
-    throw new Error("Invalid credentials");
+    throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
   }

   return { token: await generateToken(user) };
diff --git a/src/auth/errors.ts b/src/auth/errors.ts
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/src/auth/errors.ts
@@ -0,0 +1,12 @@
+export class AuthError extends Error {
+  code: string;
+
+  constructor(code: string, message: string) {
+    super(message);
+    this.code = code;
+    this.name = "AuthError";
+  }
+}
+
+export type AuthErrorCode =
+  | "INVALID_CREDENTIALS"
diff --git a/src/auth/middleware.ts b/src/auth/middleware.ts
index abcdef1..1234567 100644
--- a/src/auth/middleware.ts
+++ b/src/auth/middleware.ts
@@ -8,6 +8,7 @@ const attempts = new Map<string, number[]>();
 export async function rateLimit(key: string) {
   const now = Date.now();
   const window = attempts.get(key) ?? [];
+  // Remove attempts older than 15 minutes
   const recent = window.filter((t) => now - t < WINDOW_MS);

   if (recent.length >= MAX_ATTEMPTS) {
diff --git a/README.md b/README.md
deleted file mode 100644
index abcdef1..0000000
--- a/README.md
+++ /dev/null
@@ -1,3 +0,0 @@
-# Old README
-
-This file is no longer needed.
`;

function DiffDemo() {
  const [viewMode, setViewMode] = useState<DiffViewMode>("unified");
  const files = useMemo(() => parseDiff(SAMPLE_DIFF), []);

  const selection = useDiffSelection({
    mode: "multi",
    onSelectionChange: (selected) => {
      if (selected.length > 0) {
        log(`Diff: selected ${selected.length} line(s)`);
      }
    },
  });

  const comments = useDiffComments({
    threads: [
      {
        id: "thread-1",
        address: { filePath: "src/auth/login.ts", side: "new", lineNumber: 3 },
        comments: [
          {
            id: "c1",
            authorLogin: "reviewer",
            body: "Should we also add rate limiting to the registration endpoint?",
            createdAt: "2026-03-01T10:00:00Z",
          },
          {
            id: "c2",
            authorLogin: "author",
            body: "Good point, I'll add that in a follow-up PR.",
            createdAt: "2026-03-01T10:05:00Z",
          },
        ],
      },
    ],
    onCreateComment: async (address, body) => {
      log(`Diff: new comment on ${address.filePath}:${address.lineNumber} (${address.side}) — "${body}"`);
    },
  });

  return (
    <>
      <UISection title="UIDiffRenderer Demo">
        <UICard>
          <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
            4 files changed across an auth refactor. Click lines to select, click gutter icons to comment.
          </p>
          {selection.selected.length > 0 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <UIBadge label={`${selection.selected.length} selected`} tone="info" />
              <UIButton label="Clear" variant="ghost" size="sm" onClick={selection.clear} />
            </div>
          )}
        </UICard>
      </UISection>

      <UIDiffRenderer
        files={files}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        addons={[selection.addon, comments.addon]}
      />
    </>
  );
}

// --- First Panel (Feature Demo) ---

function FirstPanel() {
  const featureId = useSharedFeatureId();

  return (
    <UIRoot className="padded"><style>{CUSTOM_STYLES}</style>
      {!featureId && (
        <UISection>
          <UICard>
            <p style={{ opacity: 0.5, fontSize: 13 }}>Select a feature from the sidebar to view it here.</p>
          </UICard>
        </UISection>
      )}
      {featureId === "background" && <BackgroundProcessDemo />}
      {featureId === "diff" && <DiffDemo />}
      {featureId === "ui-components" && <UIComponentsDemo />}
      {featureId === "ai" && <AIDemo />}
      {featureId === "markdown" && <MarkdownDemo />}
    </UIRoot>
  );
}

// --- Instrument definition ---

export default defineReactInstrument({
  defaults: {
    visible: {
      sidebar: true,
      first: true,
    },
  },
  panels: {
    sidebar: SidebarPanel,
    first: FirstPanel,
  },
});
