# Tango API Issues

Issues found while building the PR instrument. Send to tango-api dev.

## UIMarkdownRenderer

- `.tui-markdown-body` has hardcoded `padding: 16px 18px 18px`. This is a layout decision that shouldn't belong to the renderer — instruments already control spacing via their own containers (`UISection`, `UIGroup`, custom wrappers).
- **Recommendation:** Remove the padding from `.tui-markdown-body` entirely (set to `0`). Let instruments own their own spacing. The renderer should only be responsible for rendering markdown content, not layout.

## UIPanelHeader

- Does not accept `children` — only `rightActions` prop. But `rightActions` is rendered inside a `tui-row` div, not documented as the slot for action buttons.

## UIButton

- Only accepts `label` as string prop, no `children` support. Limits composability (e.g. can't put an icon + text as children).

## UIGroupItem

- `meta` prop accepts `React.ReactNode` but the container `tui-group-item-meta` has no flex alignment — when using complex meta (e.g. multiple badges), layout can break.

## UISection

- `.tui-section-title` has no color set — inherits default text color. Section titles in content-heavy views (like PR details) benefit from an accent/teal color to visually separate them from body content. Need either:
  - A `tone` prop on `UISection` to color the title (e.g. `tone="accent"`)
  - Or a CSS variable like `--tui-section-title-color` that instruments can override

## Missing Components

- No `UIHeading` component for rendering styled headings (h1-h6) with consistent theming
- No `UIDivider` component for horizontal rules between sections
- No `UIContent` component — a content container with proper background, border-radius, and padding for wrapping sections of content (metadata, descriptions, conversations). Currently using `UICard` as workaround but it has fixed `padding: 10px` which may not suit all layouts.
