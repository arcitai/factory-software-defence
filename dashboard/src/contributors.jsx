import React, { useEffect, useRef, useState } from 'react';
import { UserRound } from 'lucide-react';

export function Contributors({ author, author_profile_url, author_avatar_url, assignees, compact = false }) {
  const assignmentsKnown = Array.isArray(assignees);
  return <div className={`issue-contributors${compact ? ' is-compact' : ''}`} aria-label="GitHub issue contributors">
    {author ? <Contributor role="Author" person={{ login: author, profile_url: author_profile_url, avatar_url: author_avatar_url }} compact={compact} />
      : <ContributorPlaceholder role="Author" label="Author unavailable" compact={compact} />}
    {assignmentsKnown && assignees.length ? assignees.map((person, index) => <Contributor key={`${person?.login || 'unknown'}-${index}`} role="Assignee" person={person} compact={compact} />)
      : <ContributorPlaceholder role="Assignee" label={assignmentsKnown ? 'Unassigned' : 'Assignment information unavailable'} compact={compact} />}
  </div>;
}

function validatedProfileURL(value, login) {
  if (typeof value !== 'string' || typeof login !== 'string' || !/^[A-Za-z0-9-]+$/.test(login)) return null;
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/([A-Za-z0-9-]+)\/?$/);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.port
      && !url.search && !url.hash && match?.[1].toLowerCase() === login.toLowerCase() ? url.href : null;
  } catch { return null; }
}

function validatedAvatarURL(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'avatars.githubusercontent.com' && !url.username && !url.password && !url.port
      && /^\/u\/[1-9][0-9]*\/?$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

function ContributorPlaceholder({ role, label, compact }) {
  const [tipPosition, setTipPosition] = useState(null), root = useRef(null);
  const positionTip = () => {
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(220, window.innerWidth - 16);
    setTipPosition({ position: 'fixed', left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - 36)) });
  };
  if (!compact) return <span className="contributor-empty"><UserRound size={13} aria-hidden="true" />{label}</span>;
  return <span ref={root} className="contributor contributor-placeholder is-compact" tabIndex={0} aria-label={`${role}: ${label}`} title={`${role}: ${label}`} onMouseEnter={positionTip} onFocus={positionTip}>
    <span className="contributor-avatar" aria-hidden="true"><UserRound size={12} /></span>
    <span className="contributor-tip" role="tooltip" style={tipPosition || undefined}>{role}: {label}</span>
  </span>;
}

function Contributor({ role, person, compact }) {
  const [imageFailed, setImageFailed] = useState(false), [tipPosition, setTipPosition] = useState(null), root = useRef(null);
  person = person && typeof person === 'object' ? person : {};
  const avatarURL = validatedAvatarURL(person.avatar_url), profileURL = validatedProfileURL(person.profile_url, person.login);
  useEffect(() => setImageFailed(false), [avatarURL]);
  const login = typeof person.login === 'string' && person.login ? person.login : 'Unavailable';
  const label = `${role}: ${login}`;
  const initials = login === 'Unavailable' ? '' : login.slice(0, 2).toUpperCase();
  const positionTip = () => {
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(220, window.innerWidth - 16);
    setTipPosition({ position: 'fixed', left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - 36)) });
  };
  const content = <>
    <span className="contributor-avatar" aria-hidden="true">
      {avatarURL && !imageFailed ? <img src={avatarURL} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
        : initials || <UserRound size={12} />}
    </span>
    {compact ? <span className="contributor-tip" role="tooltip" style={tipPosition || undefined}>{label}</span>
      : <><span className="contributor-role">{role}</span><span className="contributor-login">{login}</span></>}
  </>;
  const shared = { ref: root, className: `contributor${compact ? ' is-compact' : ''}`, 'aria-label': label,
    title: label, onMouseEnter: compact ? positionTip : undefined, onFocus: compact ? positionTip : undefined };
  return profileURL ? <a {...shared} href={profileURL} target="_blank" rel="noreferrer">{content}</a>
    : <span {...shared} tabIndex={compact ? 0 : undefined}>{content}</span>;
}
