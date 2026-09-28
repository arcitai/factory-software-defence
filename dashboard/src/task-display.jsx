import React from "react";
import { Code2, CircleAlert, Circle } from "lucide-react";

const stateTone = value => ({ running: "violet", needs_review: "amber", failed: "amber", interrupted: "amber", unknown: "amber" })[value] || "neutral";
export function TaskStateIcon({ value }) {
  const Icon = value === "running" ? Code2 : ["failed", "interrupted", "needs_review", "unknown"].includes(value) ? CircleAlert : Circle;
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
  if (!value) return "Not started";
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
  return !value || !Number.isFinite(Date.parse(value))
    ? "Unavailable"
    : new Date(value).toLocaleString();
}
export function stateLabel(value) {
  const labels = {
    not_started: "Not started",
    failed: "Failed",
    interrupted: "Interrupted",
    running: "Running",
    needs_review: "Native turn completed · needs review",
    unknown: "Unknown",
  };
  return labels[value] || (value ? friendlyName(value) : "Unknown");
}
