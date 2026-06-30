import { useState, useEffect, useMemo, useCallback } from 'react';
import { ShieldCheck, ChevronRight, ChevronDown, RefreshCw, Save } from 'lucide-react';
import asvsService from '../../services/asvsService';
import { useWebSocket } from '../../hooks/useWebSocket';
import {
  ASVS_STATUSES,
  ASVS_STATUS_LABEL,
  getAsvsStatusBadgeClass,
  getAsvsStatusStripClass,
  getAsvsStatusBarClass,
} from '../../utils/asvsStatus';
import { getSeverityBadgeClass } from '../../utils/severity';

const STATUS_FILTERS = [null, 'FAIL', 'PASS', 'NA', 'NOT_TESTED'];

const AsvsGrid = ({ assessmentId }) => {
  const [requirements, setRequirements] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const [statusFilter, setStatusFilter] = useState(null);
  const [chapterFilter, setChapterFilter] = useState('');

  const { subscribe } = useWebSocket(assessmentId);

  const loadAll = useCallback(async () => {
    try {
      const [reqs, sum] = await Promise.all([
        asvsService.list(assessmentId),
        asvsService.summary(assessmentId),
      ]);
      setRequirements(reqs);
      setSummary(sum);
      setError('');
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load ASVS grid');
    } finally {
      setLoading(false);
    }
  }, [assessmentId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Live updates: agent (or another analyst) records a verdict
  useEffect(() => {
    const unsub = subscribe('asvs_updated', (data) => {
      const updated = data?.requirement;
      if (!updated) return;
      setRequirements(prev => prev.map(r => (r.req_id === updated.req_id ? { ...r, ...updated } : r)));
      asvsService.summary(assessmentId).then(setSummary).catch(() => {});
    });
    return unsub;
  }, [subscribe, assessmentId]);

  const toggle = (reqId) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(reqId) ? next.delete(reqId) : next.add(reqId);
      return next;
    });
  };

  const chapters = useMemo(() => {
    const seen = [];
    const byId = {};
    for (const r of requirements) {
      if (!byId[r.chapter_id]) {
        byId[r.chapter_id] = true;
        seen.push({ id: r.chapter_id, name: r.chapter_name });
      }
    }
    return seen;
  }, [requirements]);

  const filtered = useMemo(() => {
    return requirements.filter(r =>
      (!statusFilter || (r.status || 'NOT_TESTED') === statusFilter) &&
      (!chapterFilter || r.chapter_id === chapterFilter)
    );
  }, [requirements, statusFilter, chapterFilter]);

  // Group filtered → chapter → section, preserving req_id order
  const grouped = useMemo(() => {
    const out = [];
    const chIdx = {};
    for (const r of filtered) {
      let ch = chIdx[r.chapter_id];
      if (!ch) {
        ch = { id: r.chapter_id, name: r.chapter_name, sections: [], secIdx: {} };
        chIdx[r.chapter_id] = ch;
        out.push(ch);
      }
      let sec = ch.secIdx[r.section_id];
      if (!sec) {
        sec = { id: r.section_id, name: r.section_name, reqs: [] };
        ch.secIdx[r.section_id] = sec;
        ch.sections.push(sec);
      }
      sec.reqs.push(r);
    }
    return out;
  }, [filtered]);

  if (loading) {
    return <div className="text-sm text-neutral-500 dark:text-neutral-400 py-6">Loading ASVS grid…</div>;
  }
  if (error) {
    return <div className="text-sm text-red-600 dark:text-red-400 py-6">{error}</div>;
  }
  if (!requirements.length) {
    return null;
  }

  const bs = summary?.by_status || {};
  const total = summary?.total || requirements.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            OWASP ASVS
            {summary?.asvs_version && <span className="text-sm font-normal text-neutral-400 ml-2">v{summary.asvs_version} · L{summary.asvs_level}</span>}
          </h2>
        </div>
        <button onClick={loadAll} className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700" title="Refresh">
          <RefreshCw className="w-4 h-4 text-neutral-500" />
        </button>
      </div>

      {/* Coverage bar */}
      <div>
        <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400 mb-1">
          <span>{summary?.tested || 0}/{total} tested ({summary?.coverage_pct ?? 0}%)</span>
          <span className="flex gap-3">
            {ASVS_STATUSES.map(s => (
              <span key={s} className="flex items-center gap-1">
                <span className={`inline-block w-2 h-2 rounded-full ${getAsvsStatusBarClass(s)}`} />
                {ASVS_STATUS_LABEL[s]} {bs[s] || 0}
              </span>
            ))}
          </span>
        </div>
        <div className="flex h-2 rounded-full overflow-hidden bg-neutral-100 dark:bg-neutral-800">
          {ASVS_STATUSES.map(s => {
            const pct = total ? ((bs[s] || 0) / total) * 100 : 0;
            return pct > 0 ? <div key={s} className={getAsvsStatusBarClass(s)} style={{ width: `${pct}%` }} title={`${ASVS_STATUS_LABEL[s]}: ${bs[s]}`} /> : null;
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map(s => (
          <button
            key={s || 'all'}
            onClick={() => setStatusFilter(s)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              statusFilter === s
                ? 'bg-primary-600 text-white border-primary-600'
                : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'
            }`}
          >
            {s ? `${ASVS_STATUS_LABEL[s]} (${bs[s] || 0})` : `All (${total})`}
          </button>
        ))}
        <select
          value={chapterFilter}
          onChange={(e) => setChapterFilter(e.target.value)}
          className="ml-auto text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-2 py-1 text-neutral-700 dark:text-neutral-300"
        >
          <option value="">All chapters</option>
          {chapters.map(c => <option key={c.id} value={c.id}>{c.id} — {c.name}</option>)}
        </select>
      </div>

      {/* Grouped grid */}
      <div className="space-y-4">
        {grouped.map(ch => (
          <div key={ch.id}>
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-2">{ch.id} · {ch.name}</h3>
            {ch.sections.map(sec => (
              <div key={sec.id} className="mb-3">
                <div className="text-xs text-neutral-400 dark:text-neutral-500 mb-1 font-mono">{sec.id} {sec.name}</div>
                <div className="space-y-1.5">
                  {sec.reqs.map(r => (
                    <AsvsRow
                      key={r.req_id}
                      req={r}
                      expanded={expanded.has(r.req_id)}
                      onToggle={() => toggle(r.req_id)}
                      assessmentId={assessmentId}
                      onSaved={(updated) => setRequirements(prev => prev.map(x => x.req_id === updated.req_id ? { ...x, ...updated } : x))}
                      refreshSummary={() => asvsService.summary(assessmentId).then(setSummary).catch(() => {})}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
        {grouped.length === 0 && (
          <div className="text-sm text-neutral-500 dark:text-neutral-400 py-4">No requirements match the current filters.</div>
        )}
      </div>
    </div>
  );
};

const AsvsRow = ({ req, expanded, onToggle, assessmentId, onSaved, refreshSummary }) => {
  const status = req.status || 'NOT_TESTED';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ status, analysis: req.analysis || '', command_used: req.command_used || '' });
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft({ status, analysis: req.analysis || '', command_used: req.command_used || '' });
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await asvsService.update(assessmentId, req.req_id, draft);
      onSaved(updated);
      refreshSummary();
      setEditing(false);
    } catch (e) {
      // keep editor open on failure
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`border-l-2 ${getAsvsStatusStripClass(status)} bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-md`}>
      {/* Row header */}
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        {expanded ? <ChevronDown className="w-4 h-4 text-neutral-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0" />}
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${getAsvsStatusBadgeClass(status)}`}>{ASVS_STATUS_LABEL[status]}</span>
        <span className="font-mono text-xs text-neutral-700 dark:text-neutral-300 shrink-0">{req.req_id}</span>
        <span className="text-[10px] text-neutral-400 shrink-0">L{req.level}</span>
        <span className="text-sm text-neutral-700 dark:text-neutral-300 truncate flex-1">{req.description}</span>
        {status === 'FAIL' && req.severity && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${getSeverityBadgeClass(req.severity)}`}>
            {req.severity}{req.cvss_score != null ? ` ${req.cvss_score}` : ''}
          </span>
        )}
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 ml-6 space-y-2 text-sm">
          <p className="text-neutral-700 dark:text-neutral-300">{req.description}</p>

          {req.test_type && (
            <div className="text-xs"><span className="text-neutral-400">Test type:</span> <span className="font-mono">{req.test_type}</span></div>
          )}
          {req.guidance && (
            <div className="text-xs italic text-neutral-500 dark:text-neutral-400">
              <span className="not-italic font-medium">Suggested method: </span>{req.guidance}
            </div>
          )}
          {req.suggested_command && (
            <pre className="text-xs bg-neutral-50 dark:bg-neutral-900 rounded p-2 overflow-x-auto text-neutral-600 dark:text-neutral-400"><code>{req.suggested_command}</code></pre>
          )}

          {!editing ? (
            <>
              {req.command_used && (
                <div className="text-xs">
                  <span className="text-neutral-400">Command used:</span>
                  <pre className="bg-neutral-50 dark:bg-neutral-900 rounded p-2 mt-1 overflow-x-auto text-neutral-700 dark:text-neutral-300"><code>{req.command_used}</code></pre>
                </div>
              )}
              {req.analysis && (
                <div className="text-xs">
                  <span className="text-neutral-400">Analysis (what the AI saw):</span>
                  <p className="mt-1 text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">{req.analysis}</p>
                </div>
              )}
              {req.evidence && (
                <div className="text-xs">
                  <span className="text-neutral-400">Evidence:</span>
                  <pre className="bg-neutral-50 dark:bg-neutral-900 rounded p-2 mt-1 overflow-x-auto text-neutral-700 dark:text-neutral-300"><code>{req.evidence}</code></pre>
                </div>
              )}
              {req.cvss_vector && (
                <div className="text-xs"><span className="text-neutral-400">CVSS:</span> <span className="font-mono">{req.cvss_vector}</span></div>
              )}
              <button onClick={startEdit} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Edit verdict</button>
            </>
          ) : (
            <div className="space-y-2 border-t border-neutral-100 dark:border-neutral-700 pt-2">
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Status</label>
                <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                  className="text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-2 py-1">
                  {ASVS_STATUSES.map(s => <option key={s} value={s}>{ASVS_STATUS_LABEL[s]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Analysis</label>
                <textarea value={draft.analysis} onChange={(e) => setDraft({ ...draft, analysis: e.target.value })} rows={3}
                  className="w-full text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-2 py-1 resize-y" />
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Command used</label>
                <input value={draft.command_used} onChange={(e) => setDraft({ ...draft, command_used: e.target.value })}
                  className="w-full text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-2 py-1 font-mono" />
              </div>
              <div className="flex gap-2">
                <button onClick={save} disabled={saving} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
                  <Save className="w-3 h-3" /> {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditing(false)} className="text-xs px-2.5 py-1 rounded border border-neutral-200 dark:border-neutral-700">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AsvsGrid;
