import { useState, useEffect, useMemo } from 'react';
import { X, Globe, Code, Server, Smartphone, Network, FileText, ShieldCheck, ChevronRight, ArrowLeft, Check, AlertTriangle, Split } from 'lucide-react';
import apiClient from '../../services/api';
import asvsService from '../../services/asvsService';
import { parseTokens, resolveTokens } from '../../utils/asvsParse';

const TEMPLATE_ICONS = {
  globe: Globe,
  code: Code,
  server: Server,
  smartphone: Smartphone,
  network: Network,
  file: FileText,
  shield: ShieldCheck,
};

// OWASP ASVS v5.0 chapters (id, name). Cumulative req counts per level (all chapters):
// L1=70, L2=253, L3=345.
const ASVS_CHAPTERS = [
  { id: 'V1', name: 'Encoding and Sanitization' },
  { id: 'V2', name: 'Validation and Business Logic' },
  { id: 'V3', name: 'Web Frontend Security' },
  { id: 'V4', name: 'API and Web Service' },
  { id: 'V5', name: 'File Handling' },
  { id: 'V6', name: 'Authentication' },
  { id: 'V7', name: 'Session Management' },
  { id: 'V8', name: 'Authorization' },
  { id: 'V9', name: 'Self-contained Tokens' },
  { id: 'V10', name: 'OAuth and OIDC' },
  { id: 'V11', name: 'Cryptography' },
  { id: 'V12', name: 'Secure Communication' },
  { id: 'V13', name: 'Configuration' },
  { id: 'V14', name: 'Data Protection' },
  { id: 'V15', name: 'Secure Coding and Architecture' },
  { id: 'V16', name: 'Security Logging and Error Handling' },
  { id: 'V17', name: 'WebRTC' },
];
const ALL_ASVS_CHAPTER_IDS = ASVS_CHAPTERS.map(c => c.id);

const CreateAssessmentModal = ({ onClose, onSuccess }) => {
  const [step, setStep] = useState('template'); // 'template' | 'form'
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    client_name: '',
    scope: '',
    limitations: '',
    objectives: '',
    target_domains: '',
    ip_scopes: '',
    start_date: '',
    end_date: '',
    category: '',
    environment: 'non_specifie',
    methodology: 'standard',
    asvs_level: 2,
    asvs_chapters: ALL_ASVS_CHAPTER_IDS,
    asvs_mode: 'level_chapters', // 'level_chapters' | 'custom'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [asvsCatalog, setAsvsCatalog] = useState([]);
  const [asvsCatalogError, setAsvsCatalogError] = useState(false);
  const [asvsCustomRaw, setAsvsCustomRaw] = useState('');

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadAsvsCatalog = async () => {
    setAsvsCatalogError(false);
    try {
      const data = await asvsService.catalog();
      setAsvsCatalog(Array.isArray(data) ? data : []);
      if (!Array.isArray(data) || data.length === 0) setAsvsCatalogError(true);
    } catch {
      setAsvsCatalog([]);
      setAsvsCatalogError(true);
    }
  };

  // Lazily fetch the static ASVS catalog the first time an ASVS template is chosen.
  // Don't auto-retry after a failure (avoids a loop) — the Retry button re-triggers it.
  useEffect(() => {
    if (formData.methodology === 'asvs' && asvsCatalog.length === 0 && !asvsCatalogError) {
      loadAsvsCatalog();
    }
  }, [formData.methodology, asvsCatalog.length, asvsCatalogError]);

  const asvsResolved = useMemo(
    () => resolveTokens(parseTokens(asvsCustomRaw), asvsCatalog),
    [asvsCustomRaw, asvsCatalog]
  );
  const asvsCustomValid = asvsResolved.matched.length > 0;

  const loadTemplates = async () => {
    try {
      const { data } = await apiClient.get('/templates');
      setTemplates(data);
    } catch (e) {
      // Templates endpoint might not exist yet, continue with blank
      setTemplates([]);
    }
  };

  const selectTemplate = async (templateId) => {
    if (templateId === 'blank') {
      setSelectedTemplate({ id: 'blank', name: 'Blank Assessment' });
      setFormData(prev => ({ ...prev, methodology: 'standard' }));
      setStep('form');
      return;
    }

    try {
      const { data } = await apiClient.get(`/templates/${templateId}`);
      setSelectedTemplate(data);
      // Auto-fill form from template
      setFormData(prev => ({
        ...prev,
        scope: data.default_scope || prev.scope,
        limitations: data.default_limitations || prev.limitations,
        objectives: data.default_objectives || prev.objectives,
        category: data.category || prev.category,
        methodology: data.methodology || 'standard',
      }));
      setStep('form');
    } catch (e) {
      setStep('form');
    }
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const isAsvs = formData.methodology === 'asvs';
      const isCustom = isAsvs && formData.asvs_mode === 'custom';
      const payload = {
        ...formData,
        target_domains: formData.target_domains
          .split(',')
          .map(d => d.trim())
          .filter(Boolean),
        ip_scopes: formData.ip_scopes
          .split(',')
          .map(ip => ip.trim())
          .filter(Boolean),
        start_date: formData.start_date || null,
        end_date: formData.end_date || null,
        category: formData.category || null,
        methodology: formData.methodology,
        // ASVS grid scoping — only sent for ASVS assessments.
        // Custom list takes precedence; otherwise level + chapters.
        asvs_level: isAsvs && !isCustom ? Number(formData.asvs_level) : null,
        asvs_chapters: isAsvs && !isCustom ? formData.asvs_chapters : null,
        asvs_req_ids: isCustom ? asvsResolved.matched : null,
      };
      delete payload.asvs_mode; // UI-only field, not part of the API schema

      const response = await apiClient.post('/assessments', payload);
      const assessmentId = response.data.id;

      // If template has phases, create sections (ASVS templates have none — grid is seeded server-side)
      if (selectedTemplate?.phases?.length > 0) {
        for (const phase of selectedTemplate.phases) {
          try {
            await apiClient.post(`/assessments/${assessmentId}/sections`, {
              // section_type is required by the API; derive "phase_N" from the phase number
              section_type: `phase_${parseInt(phase.number, 10)}`,
              section_number: phase.number,
              title: phase.title,
              content: phase.content,
            });
          } catch (e) {
            // Continue even if a section fails
          }
        }
      }

      onSuccess(response.data);
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        setError(detail.map(e => e.msg).join(', '));
      } else {
        setError(detail || 'Failed to create assessment');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/20 dark:bg-black/70 backdrop-blur-sm z-50 animate-in"
        onClick={onClose}
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-white dark:bg-neutral-800 rounded-xl shadow-strong animate-slide-up">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-neutral-700">
            <div className="flex items-center gap-3">
              {step === 'form' && (
                <button onClick={() => setStep('template')} className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded">
                  <ArrowLeft className="w-4 h-4 text-neutral-500" />
                </button>
              )}
              <div>
                <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                  {step === 'template' ? 'Choose Template' : 'Create Assessment'}
                </h2>
                {step === 'form' && selectedTemplate && selectedTemplate.id !== 'blank' && (
                  <p className="text-xs text-primary-600 dark:text-primary-400 mt-0.5">
                    Template: {selectedTemplate.name}
                  </p>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded transition-colors">
              <X className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
            </button>
          </div>

          {/* Template Selection */}
          {step === 'template' && (
            <div className="p-6 max-h-[calc(100vh-200px)] overflow-y-auto">
              <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
                Select a template to pre-fill phases, scope, and tooling recommendations — or start blank.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {templates.map(tpl => {
                  const Icon = TEMPLATE_ICONS[tpl.icon] || FileText;
                  return (
                    <button
                      key={tpl.id}
                      onClick={() => selectTemplate(tpl.id)}
                      className="flex items-start gap-3 p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:border-primary-400 dark:hover:border-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/10 transition-all text-left group"
                    >
                      <div className="w-10 h-10 rounded-lg bg-neutral-100 dark:bg-neutral-700 flex items-center justify-center shrink-0 group-hover:bg-primary-100 dark:group-hover:bg-primary-900/30">
                        <Icon className="w-5 h-5 text-neutral-500 group-hover:text-primary-600 dark:group-hover:text-primary-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{tpl.name}</span>
                          <ChevronRight className="w-4 h-4 text-neutral-300 group-hover:text-primary-500" />
                        </div>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">{tpl.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Form */}
          {step === 'form' && (
            <>
              <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[calc(100vh-200px)] overflow-y-auto">
                {error && (
                  <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
                    {error}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Assessment Name *</label>
                  <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Q4 2025 Pentest" className="input" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Client Name</label>
                  <input type="text" value={formData.client_name} onChange={(e) => setFormData({ ...formData, client_name: e.target.value })} placeholder="Acme Corporation" className="input" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Category</label>
                  <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} className="input">
                    <option value="">Select category</option>
                    <option value="API">API</option>
                    <option value="Website">Website</option>
                    <option value="External Infra">External Infra</option>
                    <option value="Internal Infra">Internal Infra</option>
                    <option value="Mobile">Mobile</option>
                    <option value="Cloud">Cloud</option>
                    <option value="General">General</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Environment</label>
                  <select value={formData.environment} onChange={(e) => setFormData({ ...formData, environment: e.target.value })} className="input">
                    <option value="non_specifie">Not specified</option>
                    <option value="production">Production</option>
                    <option value="dev">Development</option>
                  </select>
                </div>

                {formData.methodology === 'asvs' && (
                  <div className="space-y-4 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-900/10 p-4">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                      <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">OWASP ASVS v5.0 scope</span>
                    </div>

                    {/* Scope mode selector */}
                    <div className="inline-flex rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden text-xs">
                      {[
                        { id: 'level_chapters', label: 'Level + chapters' },
                        { id: 'custom', label: 'Custom list' },
                      ].map((m, i) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setFormData({ ...formData, asvs_mode: m.id })}
                          className={`px-3 py-1.5 ${i > 0 ? 'border-l border-neutral-200 dark:border-neutral-700' : ''} ${
                            formData.asvs_mode === m.id
                              ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-medium'
                              : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>

                    {formData.asvs_mode === 'level_chapters' && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Verification Level</label>
                          <select
                            value={formData.asvs_level}
                            onChange={(e) => setFormData({ ...formData, asvs_level: Number(e.target.value) })}
                            className="input"
                          >
                            <option value={1}>L1 — Standard (≈70 requirements)</option>
                            <option value={2}>L2 — Standard + Defense in depth (≈253 requirements)</option>
                            <option value={3}>L3 — Advanced / high-assurance (all 345 requirements)</option>
                          </select>
                          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Cumulative — a level includes all lower-level requirements.</p>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">Chapters</label>
                            <div className="flex gap-2 text-xs">
                              <button type="button" className="text-primary-600 dark:text-primary-400 hover:underline"
                                onClick={() => setFormData({ ...formData, asvs_chapters: ALL_ASVS_CHAPTER_IDS })}>All</button>
                              <span className="text-neutral-300">·</span>
                              <button type="button" className="text-primary-600 dark:text-primary-400 hover:underline"
                                onClick={() => setFormData({ ...formData, asvs_chapters: [] })}>None</button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
                            {ASVS_CHAPTERS.map(ch => {
                              const checked = formData.asvs_chapters.includes(ch.id);
                              return (
                                <label key={ch.id} className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer py-0.5">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      setFormData({
                                        ...formData,
                                        asvs_chapters: e.target.checked
                                          ? [...formData.asvs_chapters, ch.id]
                                          : formData.asvs_chapters.filter(id => id !== ch.id),
                                      });
                                    }}
                                    className="rounded border-neutral-300 dark:border-neutral-600 text-primary-600 focus:ring-primary-500"
                                  />
                                  <span className="font-mono text-neutral-500">{ch.id}</span>
                                  <span className="truncate">{ch.name}</span>
                                </label>
                              );
                            })}
                          </div>
                          {formData.asvs_chapters.length === 0 && (
                            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Select at least one chapter.</p>
                          )}
                        </div>
                      </>
                    )}

                    {formData.asvs_mode === 'custom' && (
                      <div>
                        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Requirements</label>
                        <textarea
                          value={asvsCustomRaw}
                          onChange={(e) => setAsvsCustomRaw(e.target.value)}
                          placeholder={'V1.2.1 V1.2.2 V1.2.3 V1.2.4 V1.2.5\nV6.2, V11'}
                          rows={4}
                          className="input resize-none font-mono text-xs"
                        />

                        {asvsCatalogError && (
                          <div className="mt-2 flex items-center justify-between gap-2 px-3 py-2 rounded-md text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
                            <span className="inline-flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Couldn't load the ASVS catalog — is the backend running?
                            </span>
                            <button type="button" onClick={loadAsvsCatalog} className="font-medium hover:underline">Retry</button>
                          </div>
                        )}

                        {asvsCustomRaw.trim() && asvsCatalog.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400">
                              <Check className="w-3.5 h-3.5" />
                              {asvsResolved.matched.length} requirement{asvsResolved.matched.length === 1 ? '' : 's'} selected
                            </span>
                            {asvsResolved.expanded.length > 0 && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400">
                                <Split className="w-3.5 h-3.5" />
                                {asvsResolved.expanded.map(e => `${e.token} → ${e.count}`).join(' · ')}
                              </span>
                            )}
                            {asvsResolved.unknown.length > 0 && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {asvsResolved.unknown.length} unknown: {asvsResolved.unknown.slice(0, 5).join(', ')}{asvsResolved.unknown.length > 5 ? '…' : ''}
                              </span>
                            )}
                          </div>
                        )}

                        {asvsResolved.byChapter.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-primary-200/60 dark:border-primary-800/60">
                            <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">Preview — what will be seeded into the grid</div>
                            <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto pr-1">
                              {asvsResolved.byChapter.map(ch => (
                                <div key={ch.chapter_id} className="flex items-center justify-between text-xs">
                                  <span className="truncate">
                                    <span className="font-mono text-neutral-500">{ch.chapter_id}</span>
                                    <span className="text-neutral-700 dark:text-neutral-300"> · {ch.chapter_name}</span>
                                  </span>
                                  <span className="shrink-0 ml-2 px-2 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300">{ch.count}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                          Accepts spaces, commas, newlines, Excel paste. <span className="font-mono">V1.2.1</span> = requirement · <span className="font-mono">V1.2</span> = whole section · <span className="font-mono">V1</span> = whole chapter.
                        </p>
                        {asvsCustomRaw.trim() && !asvsCustomValid && asvsCatalog.length > 0 && (
                          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">No valid ASVS requirement recognised yet.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Scope</label>
                  <textarea value={formData.scope} onChange={(e) => setFormData({ ...formData, scope: e.target.value })} placeholder="*.example.com, web applications, API endpoints..." rows={3} className="input resize-none" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Objectives</label>
                  <textarea value={formData.objectives} onChange={(e) => setFormData({ ...formData, objectives: e.target.value })} placeholder="Identify vulnerabilities..." rows={2} className="input resize-none" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Limitations</label>
                  <textarea value={formData.limitations} onChange={(e) => setFormData({ ...formData, limitations: e.target.value })} placeholder="No DoS attacks, no social engineering..." rows={2} className="input resize-none" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Target Domains</label>
                  <input type="text" value={formData.target_domains} onChange={(e) => setFormData({ ...formData, target_domains: e.target.value })} placeholder="example.com, app.example.com" className="input" />
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Comma-separated list</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">IP Scopes</label>
                  <input type="text" value={formData.ip_scopes} onChange={(e) => setFormData({ ...formData, ip_scopes: e.target.value })} placeholder="192.168.1.0/24, 10.0.0.0/16" className="input" />
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Comma-separated list</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Start Date</label>
                    <input type="date" value={formData.start_date} onChange={(e) => setFormData({ ...formData, start_date: e.target.value })} className="input" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">End Date</label>
                    <input type="date" value={formData.end_date} onChange={(e) => setFormData({ ...formData, end_date: e.target.value })} className="input" />
                  </div>
                </div>
              </form>

              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900">
                <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading}>Cancel</button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  className="btn btn-primary"
                  disabled={
                    loading ||
                    (formData.methodology === 'asvs' && formData.asvs_mode === 'level_chapters' && formData.asvs_chapters.length === 0) ||
                    (formData.methodology === 'asvs' && formData.asvs_mode === 'custom' && !asvsCustomValid)
                  }
                >
                  {loading ? 'Creating...' : 'Create Assessment'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default CreateAssessmentModal;
