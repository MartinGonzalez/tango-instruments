# PR Instrument — Emitted Events

Events emitted via `ctx.emit()` that other instruments (e.g., Diaries) can consume
by subscribing to `instrument.event` and filtering by `instrumentId: "pr-instrument"`.

---

## `pr.reviewed`

Fired when the user submits a review on a pull request.

| Field    | Type   | Description |
|----------|--------|-------------|
| `repo`   | string | Repository in `owner/name` format |
| `number` | number | PR number |
| `title`  | string | PR title (from cache, falls back to `#N`) |
| `author` | string | PR author login (from cache, falls back to `unknown`) |
| `action` | string | `"APPROVE"`, `"REQUEST_CHANGES"`, or `"COMMENT"` |
| `body`   | string | Review body text (may be empty) |

```typescript
{
  event: "pr.reviewed",
  payload: {
    repo: "owner/repo",
    number: 42,
    title: "Add authentication middleware",
    author: "johndoe",
    action: "APPROVE",
    body: "LGTM, nice work!"
  }
}
```

---

## `pr.commented`

Fired when the user adds a comment on a PR. Covers three comment types:
issue comments, inline review comments, and replies to review comments.

| Field         | Type   | Description |
|---------------|--------|-------------|
| `repo`        | string | Repository in `owner/name` format |
| `number`      | number | PR number |
| `title`       | string | PR title (from cache, falls back to `#N`) |
| `commentType` | string | `"issue"`, `"inline"`, or `"reply"` |
| `body`        | string | Comment body text |
| `path`        | string | (inline only) File path being commented on |
| `line`        | number | (inline only) Line number |

```typescript
// Issue comment
{
  event: "pr.commented",
  payload: {
    repo: "owner/repo",
    number: 42,
    title: "Add auth middleware",
    commentType: "issue",
    body: "Can we add tests for this?"
  }
}

// Inline review comment
{
  event: "pr.commented",
  payload: {
    repo: "owner/repo",
    number: 42,
    title: "Add auth middleware",
    commentType: "inline",
    path: "src/auth.ts",
    line: 15,
    body: "This should handle the null case"
  }
}

// Reply to review comment
{
  event: "pr.commented",
  payload: {
    repo: "owner/repo",
    number: 42,
    title: "Add auth middleware",
    commentType: "reply",
    body: "Good point, fixed in latest commit"
  }
}
```

---

## `pr.agentReviewChanged`

Fired when an agent review run changes status. This event was pre-existing.

| Field    | Type   | Description |
|----------|--------|-------------|
| `repo`   | string | Repository in `owner/name` format |
| `number` | number | PR number |
| `runId`  | string | UUID of the review run |
| `status` | string | `"running"`, `"completed"`, or `"failed"` |

```typescript
{
  event: "pr.agentReviewChanged",
  payload: {
    repo: "owner/repo",
    number: 42,
    runId: "550e8400-e29b-41d4-a716-446655440000",
    status: "completed"
  }
}
```

---

## Subscribing to these events

```typescript
// Frontend
useHostEvent("instrument.event", (data) => {
  if (data.instrumentId !== "pr-instrument") return;

  switch (data.event) {
    case "pr.reviewed":
      // data.payload: { repo, number, title, author, action, body }
      break;
    case "pr.commented":
      // data.payload: { repo, number, title, commentType, body, path?, line? }
      break;
    case "pr.agentReviewChanged":
      // data.payload: { repo, number, runId, status }
      break;
  }
});

// Backend
ctx.host.events.subscribe("instrument.event", (data) => {
  if (data.instrumentId !== "pr-instrument") return;
  // same event/payload structure
});
```
