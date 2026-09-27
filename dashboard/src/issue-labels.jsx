import React from 'react';
import { issueLabelTone } from './issue-labels.js';
export function Labels({ labels = [] }) {
  return labels.length ? <div className="issue-choice-meta">{labels.map(label => <span key={label.name} className={`issue-label label-${issueLabelTone(label.color)}`}>{label.name}</span>)}</div> : null;
}
