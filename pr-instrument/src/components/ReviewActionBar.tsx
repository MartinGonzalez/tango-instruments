// ReviewActionBar — Submit GitHub PR reviews (Comment, Approve, Request Changes)

import React, { useCallback, useState } from "react";
import {
  useInstrumentApi,
  UIButton,
  UITextarea,
  UIMarkdownRenderer,
  UISegmentedControl,
  UIIconButton,
} from "tango-api";

type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

const BODY_HEIGHT = 200;

export function ReviewActionBar(props: {
  repo: string;
  number: number;
  isAuthor: boolean;
  onSubmitted?: () => void;
}) {
  const api = useInstrumentApi();
  const [activeAction, setActiveAction] = useState<ReviewEvent | null>(null);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<string>("raw");

  const handleToggle = useCallback((event: ReviewEvent) => {
    setActiveAction((prev) => {
      if (prev === event) return null;
      setMode("raw");
      return event;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!activeAction) return;
    setSubmitting(true);
    try {
      await api.actions.call("submitReview", {
        repo: props.repo,
        number: props.number,
        event: activeAction,
        body: body.trim() || undefined,
      });
      setActiveAction(null);
      setBody("");
      setMode("raw");
      props.onSubmitted?.();
    } catch {
      // error feedback can be added later
    } finally {
      setSubmitting(false);
    }
  }, [api, props.repo, props.number, activeAction, body, props.onSubmitted]);

  const canSubmit = activeAction !== "REQUEST_CHANGES" || body.trim().length > 0;
  const showReviewActions = !props.isAuthor;

  return (
    <div className="tui-col" style={{ gap: 8 }}>
      {activeAction && (
        <div style={{
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--tui-border)",
          borderRadius: "var(--tui-radius-panel)",
          background: "var(--tui-bg-card)",
          overflow: "hidden",
        }}>
          {/* Header — segmented control left, send button far right */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 10px",
            borderBottom: "1px solid var(--tui-border)",
            background: "var(--tui-bg-secondary)",
            flexShrink: 0,
          }}>
            <UISegmentedControl
              options={[
                { value: "raw", label: "Raw" },
                { value: "preview", label: "Preview" },
              ]}
              value={mode}
              onChange={setMode}
            />
            <UIIconButton
              icon="send"
              label={submitting ? "Submitting..." : "Submit review"}
              variant="primary"
              size="sm"
              disabled={submitting || !canSubmit}
              onClick={handleSubmit}
            />
          </div>

          {/* Body — fixed height, content pinned via absolute positioning */}
          <div style={{ position: "relative", height: BODY_HEIGHT }}>
            {mode === "preview" ? (
              <div style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                overflowY: "auto",
                padding: "10px 12px",
                fontSize: 12,
                boxSizing: "border-box",
              }}>
                {body.trim() ? (
                  <UIMarkdownRenderer content={body} />
                ) : (
                  <span style={{ color: "var(--tui-text-secondary)" }}>Nothing to preview</span>
                )}
              </div>
            ) : (
              <textarea
                value={body}
                placeholder={activeAction === "REQUEST_CHANGES" ? "Describe the changes needed..." : "Leave a comment (optional)"}
                onChange={(e) => setBody(e.target.value)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  width: "100%",
                  height: "100%",
                  resize: "none",
                  border: "none",
                  background: "transparent",
                  color: "var(--tui-text)",
                  fontFamily: "inherit",
                  fontSize: 13,
                  padding: "10px 12px",
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
            )}
          </div>
        </div>
      )}

      <div className="tui-row" style={{ gap: 6 }}>
        <UIButton label="Comment" variant="secondary" size="sm" fullWidth disabled={submitting} onClick={() => handleToggle("COMMENT")} />
        {showReviewActions && (
          <>
            <UIButton label="Approve" variant="success" size="sm" fullWidth disabled={submitting} onClick={() => handleToggle("APPROVE")} />
            <UIButton label="Request Changes" variant="danger" size="sm" fullWidth disabled={submitting} onClick={() => handleToggle("REQUEST_CHANGES")} />
          </>
        )}
      </div>
    </div>
  );
}
