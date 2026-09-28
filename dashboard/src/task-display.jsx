import React from "react";
import { Check, Code2, CircleAlert, Eye, Circle } from "lucide-react";
const zeroTime = "0001-01-01T00:00:00Z";

const stateTone = value => ({ running: "violet", queued: "cyan", awaiting_approval: "pink", succeeded: "green", needs_review: "amber", failed: "amber", timed_out: "amber", blocked: "amber", interrupted: "amber" })[value] || "neutral";
export function TaskStateIcon({ value }) {
  const Icon = value === "succeeded" ? Check : value === "running" ? Code2 : ["failed", "blocked", "timed_out", "interrupted", "needs_review"].includes(value) ? CircleAlert : value === "awaiting_approval" ? Eye : Circle;
  return <span className={`task-status-icon tone-${stateTone(value)}`} aria-hidden="true"><Icon size={14} /></span>;
}
export function State({ value }) {
  return <span className={`task-state tone-${stateTone(value)}`}><span className="state-dot" />{stateLabel(value)}</span>;
}

export function friendlyName(name) {
  return String(name || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/^./, (c) => c.toUpperCase());
}
export function relativeTime(value) {
  if (!value || value === zeroTime) return "Not started";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unavailable";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - timestamp) / 1000),
  );
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
export function formatTimestamp(value) {
  return !value || value === zeroTime || !Number.isFinite(Date.parse(value))
    ? "Unavailable"
    : new Date(value).toLocaleString();
}
export function stateLabel(value) {
  const labels = {
    not_started: "Not started",
    awaiting_approval: "Awaiting acceptance",
    cancelling: "Cancelling",
    failed: "Failed",
    interrupted: "Interrupted",
    queued: "Queued",
    running: "Running",
    succeeded: "Completed",
    needs_review: "Native turn completed · needs review",
    timed_out: "Timed out",
    cancelled: "Cancelled",
    blocked: "Blocked",
  };
  return labels[value] || (value ? friendlyName(value) : "Unknown");
}
