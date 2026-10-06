import React from "react";
import { Circle, CircleAlert, CircleCheck, CircleHelp, CirclePause, CircleX, Code2, Eye, FilePenLine, FileText, Inbox as InboxGlyph, TriangleAlert } from "lucide-react";
import { nativeState } from '../../factory/issue-lifecycle.mjs';

const glyphs = Object.freeze({ inbox: InboxGlyph, file_text: FileText, file_pen: FilePenLine, circle_check: CircleCheck,
  code: Code2, eye: Eye, triangle_alert: TriangleAlert, circle_x: CircleX, circle_help: CircleHelp, circle: Circle, pause: CirclePause });

export function LifecycleGlyph({ definition, size = 14 }) {
  const Icon = glyphs[definition?.icon] || CircleHelp;
  return <Icon size={size} aria-hidden="true" />;
}

export function TaskStateIcon({ value }) {
  const definition = nativeState(value);
  const Icon = glyphs[definition.icon] || CircleAlert;
  return <span className={`task-status-icon tone-${definition.tone}`} aria-hidden="true"><Icon size={14} /></span>;
}
export function State({ value }) {
  const definition = nativeState(value);
  return <span className={`task-state tone-${definition.tone}`}><LifecycleGlyph definition={definition} size={12} />{definition.label}</span>;
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
// The bridge reports the selected native harness; Codex is the default.
export function harnessLabel(value) {
  return value==='claude' ? 'Claude' : 'Codex';
}

export function stateLabel(value) {
  return nativeState(value).label;
}
