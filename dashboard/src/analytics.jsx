import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ChevronDown, Clock3, RefreshCw, Sparkles, TerminalSquare } from 'lucide-react';

const harnessName = value => ({ codex: 'Codex', claude: 'Claude Code' })[value] || value || 'Native harness';
const validPercent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const percent = value => Number(value.toFixed(1));
const time = value => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : 'Not reported';

function reading(profile, now, failed) {
  const expired = Boolean(profile.expires_at && Date.parse(profile.expires_at) <= now);
  const windows = expired ? [] : profile.windows || [];
  const reported = windows.filter(limit => validPercent(limit.used_percent));
  const stale = reported.length > 0 && (failed || profile.status === 'last_known'
    || windows.some(limit => limit.resets_at && Date.parse(limit.resets_at) <= now)
    || (profile.checked_at && now - Date.parse(profile.checked_at) > 120000));
  return { windows, reported, expired, state: stale ? 'Last known' : reported.length && profile.status === 'reported' ? 'Reported' : 'Unavailable' };
}

export function Analytics({ token }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(false), [now, setNow] = useState(Date.now());
  const request = useRef(null);
  const refresh = useCallback(async () => {
    if (!token) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const response = await fetch('/api/v1/usage', {
        headers: { Accept: 'application/json', 'X-Factory-Session': token },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(55000)]),
      });
      if (!response.ok) throw Error('Usage could not be refreshed. Try again.');
      const result = await response.json();
      if (!Array.isArray(result.profiles)) throw Error('Usage response is unavailable.');
      if (!controller.signal.aborted) { setData(result); setError(''); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.name === 'TimeoutError' ? 'Usage took too long to respond. Try again.' : failure.message);
    } finally {
      if (!controller.signal.aborted) { setLoading(false); setNow(Date.now()); }
    }
  }, [token]);

  useEffect(() => {
    setData(null); setError(''); setLoading(false);
    refresh();
    return () => request.current?.abort();
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const profiles = data?.profiles || [];
  const readings = profiles.map(profile => reading(profile, now, Boolean(error)));
  const zones = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return <section className="analytics-page" aria-labelledby="analytics-title">
    <header className="analytics-heading">
      <div><h2 id="analytics-title">Analytics</h2><p>Your connected harnesses, at a glance.</p></div>
      <button className="usage-refresh" onClick={refresh} disabled={loading || !token} aria-label="Refresh usage"><RefreshCw size={14} className={loading ? 'is-refreshing' : ''}/>Refresh</button>
    </header>
    <div className="usage-tools" role="status">{!token ? 'Waiting for the Factory connection…' : loading ? 'Reading native usage…' : error || 'Account limits · including activity outside this project'}</div>
    <dl className="usage-summary">
      <div><dt>Connected profiles</dt><dd>{data ? profiles.length : '—'}</dd><span>Linked for usage visibility</span></div>
      <div><dt>Reported windows</dt><dd>{data ? readings.reduce((total, item) => total + item.reported.length, 0) : '—'}</dd><span>Independent allowances</span></div>
      <div><dt>Need a fresh reading</dt><dd>{data ? readings.filter(item => item.state !== 'Reported').length : '—'}</dd><span>Last known or unavailable</span></div>
    </dl>
    <div className="usage-section-heading"><h3>Harness usage</h3><span>Remaining allowance</span></div>
    <div className="usage-profiles" aria-busy={loading}>
      {profiles.map((profile, index) => <UsageProfile key={profile.id} profile={profile} snapshot={readings[index]} now={now}
        ordinal={profiles.filter(item => item.harness === profile.harness).length > 1 ? profiles.slice(0, index + 1).filter(item => item.harness === profile.harness).length : null}/>)}
      {!data && <div className="usage-page-empty"><Activity size={24}/><h3>{loading ? 'Loading your limits' : error ? 'Usage is unavailable' : 'Connecting to Factory'}</h3><p>{error ? 'Refresh to try the native harnesses again.' : 'Each profile will show the windows reported by its harness.'}</p></div>}
      {data && !profiles.length && <div className="usage-page-empty"><Activity size={24}/><h3>No connected profiles</h3><p>Connected Factory profiles appear here when they are available.</p></div>}
    </div>
    <footer className="usage-footnote"><p>Each window stands on its own. Percentages are account allowances, not token costs or charges. Different profiles can share an account.</p><p>Readings refresh at most every two minutes. Reset times use {zones || 'your local time zone'}. A reset time passing does not confirm a new allowance.</p></footer>
  </section>;
}

function UsageProfile({ profile, snapshot, now, ordinal }) {
  const { windows, expired, state } = snapshot;
  const Icon = profile.harness === 'claude' ? Sparkles : profile.harness === 'codex' ? TerminalSquare : Activity;
  return <section className={`usage-profile usage-${profile.harness}`} aria-label={`${harnessName(profile.harness)}${ordinal ? ` profile ${ordinal}` : ''} usage`}>
    <header className="usage-profile-heading">
      <span className="usage-provider-mark" aria-hidden="true"><Icon size={22}/></span>
      <div className="usage-provider-name"><h4>{harnessName(profile.harness)}{ordinal && <small>Profile {ordinal}</small>}</h4><span className="usage-plan">{profile.plan || 'Plan not reported'}</span></div>
      <span className={`usage-state ${state === 'Last known' ? 'is-stale' : state === 'Unavailable' ? 'is-unavailable' : ''}`}><i/>{state}</span>
    </header>
    {windows.length ? <div className="usage-windows">{windows.map(limit => {
      const used = limit.used_percent, valid = validPercent(used);
      const past = limit.resets_at && Date.parse(limit.resets_at) <= now;
      return <div className={`usage-window ${valid && used >= 90 ? 'usage-high' : valid && used >= 70 ? 'usage-elevated' : ''}`} key={limit.id}>
        <div className="usage-window-heading">{limit.label}</div>
        <div className="usage-allowance"><strong>{valid ? percent(100 - used) : '—'}{valid && <small>%</small>}</strong><span>{valid ? 'remaining' : 'Unavailable'}</span></div>
        {valid && <meter min="0" max="100" value={100 - used} aria-label={`${limit.label}: ${percent(100 - used)}% remaining`}/>}
        <div className="usage-window-detail"><span>{valid ? `${percent(used)}% used in this reading` : 'No percentage reported'}</span><span><Clock3 size={12} aria-hidden="true"/>{past ? 'Reset time passed · refresh' : limit.resets_at ? `Resets ${time(limit.resets_at)}` : 'Reset not reported'}</span></div>
      </div>;
    })}</div> : <div className="usage-empty"><span className="usage-empty-value">—</span><p>{expired ? 'The last observation has expired.' : 'No limits reported yet.'}</p><span>Refresh to check for a native reading.</span></div>}
    <details className="usage-reading-details"><summary><span>{profile.checked_at ? `Read ${time(profile.checked_at)}` : `Last attempt ${time(profile.attempted_at)}`}</span><span>Reading details<ChevronDown size={13}/></span></summary>
      <div className="usage-source"><p>{profile.source || 'Native account limits'}</p>{profile.note && <p>{profile.note}</p>}<p>{state === 'Last known' ? 'These are retained values. They do not confirm current availability.' : state === 'Unavailable' ? 'Missing limits stay unavailable; no usage is inferred.' : 'The native harness decides whether work can run.'}</p></div>
    </details>
  </section>;
}
