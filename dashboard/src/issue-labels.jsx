import React, { useEffect, useId, useRef, useState } from 'react';
import { issueLabelTone } from './issue-labels.js';

const validColor = color => /^[a-f0-9]{6}$/i.test(color || '');
const readableColor = color => validColor(color) ? `#${color.toUpperCase()}` : 'color unavailable';

export function Labels({ labels = [] }) {
  const [open, setOpen] = useState(false), [tooltipPosition, setTooltipPosition] = useState(null), id = useId(), root = useRef(null);
  const summary = labels.map(label => `${label.name} (${readableColor(label.color)})`).join(', ');
  const countLabel = `${labels.length} ${labels.length === 1 ? 'label' : 'labels'}`;
  const positionTooltip = () => {
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(270, window.innerWidth - 32), height = Math.min(window.innerHeight * .7, 48 + labels.length * 22);
    setTooltipPosition({ position: 'fixed', left: Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16)),
      top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8)) });
  };
  const closeIfInactive = () => {
    if (!root.current?.matches(':hover') && !root.current?.contains(document.activeElement)) setOpen(false);
  };
  useEffect(() => {
    if (!open || !labels.length) return;
    const reposition = () => positionTooltip();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => { window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  }, [open, labels.length]);
  if (!labels.length) return <span className="label-summary-empty" aria-label="0 labels">0 labels</span>;
  return <span ref={root} className="label-summary-wrap" onMouseEnter={() => { positionTooltip(); setOpen(true); }} onMouseLeave={closeIfInactive} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
  }}>
    <button type="button" className="label-summary" aria-label={`${countLabel}: ${summary}`} aria-describedby={id} aria-expanded={open}
      onFocus={() => { positionTooltip(); setOpen(true); }} onBlur={closeIfInactive} onClick={() => { positionTooltip(); setOpen(value => !value); }}>
      <span className="label-dots" aria-hidden="true">{labels.slice(0, 5).map((label, index) => <span key={`${label.name}-${index}`}
        className={`label-dot label-${issueLabelTone(label.color)}`}
        style={validColor(label.color) ? { '--label-dot-color': `#${label.color}` } : undefined} />)}</span>
      <span className="label-count">{countLabel}</span>
    </button>
    <span id={id} role="tooltip" className="label-tooltip" style={tooltipPosition || undefined} hidden={!open}>
      <strong>{labels.length} {labels.length === 1 ? 'label' : 'labels'}</strong>
      <span className="label-tooltip-list">{labels.map((label, index) => <span className="label-tooltip-item" key={`${label.name}-${index}`}>
        <span className={`label-tooltip-dot label-${issueLabelTone(label.color)}`} style={validColor(label.color) ? { '--label-dot-color': `#${label.color}` } : undefined} aria-hidden="true" />
        <span>{label.name}</span><code>{readableColor(label.color)}</code>
      </span>)}</span>
    </span>
  </span>;
}
