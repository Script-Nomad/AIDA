# OWASP ASVS Assessment Template — Implementation Plan

> **Status:** proposal, awaiting validation. **No feature code is written yet.**
> This document is the file-by-file blueprint. Implement only after sign-off.

## 0. Decisions locked (from alignment round)

| # | Decision | Choice |
|---|----------|--------|
| ① | FAIL ↔ findings/severity | **Self-contained requirement** — each ASVS row stores its own `status` + `analysis` + `command_used` + (on FAIL) `severity`/`cvss`. The PDF derives its "findings" from FAILed requirements. **No separate `Card` is created.** Single source of truth. |
| ② | Grid scoping at creation | **Level (L1/L2/L3) + chapters (V1–V17 subset)**. Seed only rows where `level ≤ chosen_level` **AND** `chapter ∈ chosen_chapters`. |
| ③ | Per-row test guidance | **Both columns.** Static `guidance`/`suggested_command`/`test_type` (nullable, pre-authored, **backfillable**) **+** dynamic `command_used`/`analysis` (agent). Schema + UI built now; the 345-row enrichment is a **separate pass you validate**. |
| ④ | ASVS agent mode | **`methodology` field on the assessment**; `aida.py` auto-selects `PrePrompt-ASVS.txt` when an ASVS assessment is loaded. |

## 1. Background — how the system works today (verified)

- **Templates** are static Python dicts in `backend/services/template_service.py`, served read-only via `GET /templates`. They are **not** stored on the assessment. Seeding is done **client-side**: `CreateAssessmentModal.jsx` loops `template.phases` and `POST`s each as a `section`. The backend `AssessmentService.create_assessment` writes only the `Assessment` row + provisions the container workspace.
  - **Latent bug to fix in passing:** that client section `POST` omits `section_type`, which `SectionCreate` requires → 422 swallowed by a `try/catch`.
- **Findings** = `Card` rows (`card_type` finding/observation/info), created by the agent via the MCP tool `add_card`/`update_card`. CVSS 4.0 vector → score/severity derived server-side.
- **Agent loop**: 18 MCP tools (`backend/mcp/modules/mcp_tools.py` defs, `mcp_handlers.py` dispatch, `mcp_classes.py` httpx calls). The agent identifies the active assessment via `current_assessment_id` (set on `load_assessment`), **not** an `assessment_id` arg. There is **no tool to read/write the methodology checklist** — the agent only sees phases once, in the `load_assessment` text blob.
- **Preprompt** (`Docs/PrePrompt.txt`) is **global**, loaded by `aida.py` (not the backend), delivered to Claude (`--system-prompt`), Kimi (`.aida/kimi-system.md`, regenerated each launch — never hand-edit), Qwen (`QWEN.md`). A `--preprompt FILE` flag already exists.
- **Frontend** `AssessmentDetail.jsx` is **not tabbed** — it stacks self-fetching sections. `CardsTable.jsx` is an expandable-row list (not an HTML table) with a left severity color strip + badge + expand panel; **this is the pattern the ASVS grid mirrors.**
- **DB**: `database.py::init_db()` always runs `Base.metadata.create_all()` → new models picked up automatically, **no Alembic migration** needed (matches project preference). Model must be **imported** in `models/__init__.py` to register on `Base.metadata`.
- **Reports**: `report_service.py` → Jinja2 `report.html.j2` → WeasyPrint. Pulls cards/recon/credentials + `methodology.md` from the workspace. Severity vocab lives as module dicts (`SEVERITY_ORDER/COLORS/BG`); there are **no Python `Enum`s** (string columns + comments).
- **ASVS v5.0.0**: 345 requirements, 17 chapters, 80 sections, levels **L1=70 / L2=183 / L3=92** (cumulative: L1=70, ≤L2=253, ≤L3=345).

## 2. Data model

### 2.1 New model — `backend/models/asvs_requirement.py`

Per-assessment instance rows, seeded at creation. Static catalog fields are denormalized onto each row (345 × N is trivial in Postgres; zero joins).

```python
class AsvsRequirement(Base):
    __tablename__ = "asvs_requirements"

    id            = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("assessments.id", ondelete="CASCADE"),
                           nullable=False, index=True)

    # --- ASVS catalog (static, from seed JSON) ---
    chapter_id    = Column(String(10),  index=True)   # "V1"
    chapter_name  = Column(String(255))               # "Encoding and Sanitization"
    section_id    = Column(String(10),  index=True)   # "V1.2"
    section_name  = Column(String(255))               # "Injection Prevention"
    req_id        = Column(String(20),  index=True)   # "V1.2.4"
    level         = Column(Integer)                   # 1 | 2 | 3
    description   = Column(Text)                       # official ASVS req_description

    # --- pre-authored guidance (static, nullable, BACKFILLABLE) ---
    test_type        = Column(String(20))   # dast | whitebox | manual
    guidance         = Column(Text)         # "how to test" (1-3 sentences)
    suggested_command= Column(Text)         # optional suggested command

    # --- agent-filled verdict ---
    status        = Column(String(20), default="NOT_TESTED", index=True)
                    # NOT_TESTED | PASS | FAIL | NA
    command_used  = Column(Text)            # what the agent actually ran
    analysis      = Column(Text)            # "what the AI saw"
    evidence      = Column(Text)            # raw output / proof (optional)

    # --- severity (only meaningful on FAIL) ---
    severity      = Column(String(20))      # CRITICAL|HIGH|MEDIUM|LOW|INFO
    cvss_vector   = Column(String(255))
    cvss_score    = Column(Float)

    created_at    = Column(TIMESTAMP, server_default=func.now())
    updated_at    = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    assessment = relationship("Assessment", back_populates="asvs_requirements")
```

**Status vocabulary:** stored uppercase tokens `NOT_TESTED | PASS | FAIL | NA` (display `N/A`). Follows the existing "string column + module constant" convention — no `Enum`.

### 2.2 `backend/models/assessment.py` — add 3 columns + relationship

```python
methodology  = Column(String(50), default="standard")  # "standard" | "asvs"
asvs_level   = Column(Integer, nullable=True)           # 1 | 2 | 3 (ASVS only)
asvs_version = Column(String(20), nullable=True)        # "5.0.0"
# ...
asvs_requirements = relationship("AsvsRequirement", back_populates="assessment",
                                 cascade="all, delete-orphan")
```

### 2.3 `backend/models/__init__.py` — register

Add `from .asvs_requirement import AsvsRequirement` and append to `__all__`. (Required so `create_all` sees the table — no migration.)

### 2.4 Seed data — `backend/data/asvs_v5.json` + builder

- **`tools/build_asvs_seed.py`** (versioned): reads the official CSV (already fetched locally at `/tmp/asvs_v5.csv` during planning; bundle a copy under `tools/`), emits `backend/data/asvs_v5.json` as an array of objects:
  `{chapter_id, chapter_name, section_id, section_name, req_id, level, description, test_type?, guidance?, suggested_command?}`.
- The static catalog (incl. guidance once enriched) is the **source of truth** for seeding. Bundling JSON keeps it **offline/air-gap friendly** (no runtime fetch from GitHub).
- v1 ships with `guidance/test_type/suggested_command` **empty**; the enrichment pass (§7) fills them and you review the diff.

## 3. Backend API

### 3.1 New router — `backend/api/asvs_requirements.py`

Prefix `/assessments/{assessment_id}/asvs`, auth-protected like cards. Mirror `api/cards.py`.

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| GET | `""` | — | `List[AsvsRequirementResponse]` | filters `?status=&chapter=&level=`; ordered by `req_id` |
| GET | `/summary` | — | `AsvsSummaryResponse` | counts per status + per chapter + coverage % |
| GET | `/{req_id}` | — | `AsvsRequirementResponse` | 404 if absent |
| PATCH | `/{req_id}` | `AsvsRequirementUpdate` | `AsvsRequirementResponse` | derives `cvss_score`/`severity` from `cvss_vector`; broadcasts `event_asvs_updated` |

- Lookup by `req_id` is scoped to `assessment_id` (the `(assessment_id, req_id)` pair is unique).
- **CVSS derivation:** reuse the same CVSS4 logic cards use (`_calculate_cvss4_score`/`_score_to_severity`, currently in `mcp_handlers.py`). To call it from the backend route, lift it into **`backend/utils/cvss.py`** and import from both the route and the MCP handler (removes the current duplication risk).

### 3.2 Schemas — `backend/schemas/asvs_requirement.py`

`AsvsRequirementBase` (all catalog + verdict fields) · `AsvsRequirementCreate` · `AsvsRequirementUpdate` (all optional: `status`, `analysis`, `command_used`, `evidence`, `severity`, `cvss_vector`) · `AsvsRequirementResponse` (+ id/timestamps, `from_attributes=True`) · `AsvsSummaryResponse` (`total`, `by_status: dict`, `by_chapter: list`, `coverage_pct`).

### 3.3 Server-side seeding on create

- Extend `AssessmentCreate` (`schemas/assessment.py`) with: `methodology: str = "standard"`, `asvs_level: Optional[int] = None`, `asvs_chapters: Optional[list[str]] = None`.
- In `AssessmentService.create_assessment` (`services/assessment_service.py`), after the assessment row is committed: **if `methodology == "asvs"`**, load `backend/data/asvs_v5.json`, filter `level <= asvs_level` **AND** `chapter_id in asvs_chapters`, bulk-insert `AsvsRequirement` rows in one transaction, and persist `methodology`/`asvs_level`/`asvs_version` on the assessment.
- `asvs_chapters` is **not** stored as a column — the seeded rows are the record. Only `methodology`/`asvs_level`/`asvs_version` persist.
- This replaces the client-side phase loop for ASVS (the standard templates keep their existing client seeding).

### 3.4 `backend/main.py` — wire router

Add `asvs_requirements` to the `from api import (...)` block and `app.include_router(asvs_requirements.router, prefix=settings.API_V1_PREFIX, dependencies=protected)` alongside the other protected routers.

## 4. Agent — MCP tools + preprompt + launcher

### 4.1 Three new MCP tools

Defined in `mcp_tools.py::get_tool_definitions()`, dispatched in `mcp_handlers.py::handle_tool_call()`, backed by service methods in `mcp_classes.py` (httpx → backend routes above). Auto-exposed on **both** stdio + HTTP transports via `server_builder.build_mcp_server()`. All use `current_assessment_id` (no `assessment_id` arg), per existing convention.

1. **`list_asvs_requirements(status?, chapter?, level?)`** → `GET …/asvs`. *Fills the current gap: the agent can finally read its checklist on demand.*
2. **`get_asvs_summary()`** → `GET …/asvs/summary`. Lets the agent see what remains.
3. **`update_asvs_requirement(req_id, status, analysis, command_used?, evidence?, severity?, cvss_vector?)`** → `PATCH …/asvs/{req_id}`.
   - `status ∈ {PASS, FAIL, NA, NOT_TESTED}`.
   - On FAIL with `cvss_vector`, the backend derives score/severity (same as cards).

Also extend `_handle_load_assessment` so the loaded-context blob includes an ASVS coverage line (e.g. `ASVS: 12/253 tested — 3 FAIL, 7 PASS, 2 N/A`) when `methodology=="asvs"`.

### 4.2 New preprompt — `Docs/PrePrompt-ASVS.txt`

A grid-walking control loop (distinct from the opportunistic default). Outline:

- **Mode**: "This is an OWASP ASVS v5.0 verification engagement. Work the requirement grid exhaustively; do not improvise scope."
- **Loop**: `get_asvs_summary()` → `list_asvs_requirements(status="NOT_TESTED")` → iterate **by chapter → section → req_id**. For each requirement:
  1. Decide applicability. If out of scope/not applicable → `update_asvs_requirement(req_id, status="NA", analysis="<reason>")`. Use `test_type` to recognize whitebox/manual items that need source/config — if unavailable, mark `NA` with a reason or ask the user; **never hallucinate PASS/FAIL.**
  2. Test it (use `guidance`/`suggested_command` if present; otherwise apply expert method).
  3. Record verdict: `update_asvs_requirement(req_id, status=PASS|FAIL, command_used=..., analysis=..., evidence=...)`.
  4. On **FAIL**, add `cvss_vector` (or `severity` fallback) — this is what the PDF surfaces as a finding.
- **Discipline**: "Mark **every** requirement before declaring the engagement complete. No silent skips."
- **No `add_card` for ASVS findings** — the verdict lives on the requirement (decision ①). `add_card` remains available for out-of-band observations only.
- Reuse the unchanged blocks from `PrePrompt.txt`: Identity, scope rules, container/workspace, error handling, proof requirement.

### 4.3 `aida.py` — methodology-driven preprompt selection

At the preprompt-load / assessment-augmentation blocks (~L699–796): when the loaded assessment has `methodology == "asvs"`, select `Docs/PrePrompt-ASVS.txt` instead of `Docs/PrePrompt.txt` (unless `--preprompt` overrides). Propagates to Claude/Kimi/Qwen with no per-client change. The assessment's methodology is read from the backend (already fetched on load).

## 5. Frontend

### 5.1 ASVS template entry — `template_service.py`

Add an `"owasp_asvs"` template with `methodology: "asvs"` (and `icon: "shield"` / `"file"`). It appears automatically in the create modal grid. It carries **no** `phases` (the grid is seeded server-side).

### 5.2 `CreateAssessmentModal.jsx` — level + chapters selectors

- When `selectedTemplate.methodology === "asvs"`: render, after the Category select (~L221):
  - **Niveau** `<select>` L1 / L2 / L3 (with req counts: L1=70, L2=253, L3=345 cumulative).
  - **Chapitres** multi-select (checkbox list) V1–V17 with names + per-chapter counts. Default = all selected.
- `handleSubmit`: for ASVS, include `methodology`, `asvs_level`, `asvs_chapters` in the `POST /assessments` payload and **skip** the client-side phase→section loop (server seeds). Fix the `section_type` bug in the standard path while here.

### 5.3 New component — `frontend/src/components/assessment/AsvsGrid.jsx`

Self-fetching (takes `assessmentId`), mirrors `CardsTable`'s visual idiom:
- Loads `GET …/asvs` + `…/asvs/summary`; subscribes to `event_asvs_updated` over the existing WebSocket.
- **Header**: coverage bar (tested / total, PASS/FAIL/N-A/NOT_TESTED segments) + filter pills (status, chapter, level).
- **Grouping**: chapter → section → requirement rows.
- **Row**: left status color strip (PASS green / FAIL red / N/A grey / NOT_TESTED neutral) · status badge · `req_id` (mono) · description (truncated) · level chip · severity/CVSS when FAIL.
- **Expand panel**: `guidance` (greyed "Méthode suggérée") · `suggested_command` · `command_used` · `analysis` ("Ce que l'IA a vu") · evidence · CVSS vector/score. Inline `PATCH …/asvs/{req_id}` for manual edits (analyst can override a verdict), then refetch — same pattern CardsTable uses.
- Reuse `utils/severity.js` helpers; add an `asvsStatus.js` helper for status colors.

### 5.4 `AssessmentDetail.jsx` — insert the grid

Render `<AsvsGrid assessmentId={parseInt(id)} />` as a new stacked section **after Cards & Findings, before `MethodologyReport`** (~L988), shown only when `assessment.methodology === "asvs"`. No change to the page's `Promise.all` (grid self-fetches).

### 5.5 Service — `frontend/src/services/asvsService.js`

Thin `apiClient` wrapper: `list(assessmentId, params)`, `summary(assessmentId)`, `update(assessmentId, reqId, data)` (PATCH).

## 6. Reports (PDF)

- `report_service.py`: when the assessment is ASVS, query `AsvsRequirement`, compute coverage stats (counts per status, % per chapter), pass into `template.render(...)`. Add an `ASVS_STATUS_COLORS` module dict parallel to `SEVERITY_COLORS` (PASS green, FAIL red, N/A grey, NOT_TESTED neutral).
- `report.html.j2`: add a conditional `{% if asvs %}` section (with TOC counter increment in the precompute block ~L82–90): a **coverage summary** strip + a **FAILed-requirements table** (the "findings", with `analysis`/CVSS, `| markdown | safe`) + an optional **full-grid appendix**. Place after Methodology / before Recon.
- The Executive Summary's risk banner can incorporate ASVS FAIL severities (reuse `_compute_risk_score` over FAIL rows).

## 7. Guidance enrichment pass (separate, you validate) — decision ③

A standalone workflow (run after the schema/UI land): for each of the 345 requirements, generate `test_type` (dast/whitebox/manual) + `guidance` (1–3 sentence method) + `suggested_command` (when tool-testable), fan-out by chapter, adversarially sanity-check, emit an updated `backend/data/asvs_v5.json`. **You review the diff before it's committed.** Existing assessments can be re-seeded or backfilled by `req_id`.

## 8. Phasing & acceptance

| Phase | Scope | Done when |
|---|---|---|
| 1 | Data: model + `assessment` columns + `__init__` register + `asvs_v5.json` (CSV→JSON, guidance empty) | table auto-created on boot; JSON has 345 rows |
| 2 | Backend: schemas + router + server-side seeding + `main.py` wiring + `utils/cvss.py` | creating an ASVS assessment (L2, all chapters) seeds 253 rows; GET/PATCH/summary work |
| 3 | Agent: 3 MCP tools + `PrePrompt-ASVS.txt` + `aida.py` selection + load-context line | agent can list, update, and summarize the grid; ASVS prompt loads for ASVS assessments |
| 4 | Frontend: modal (level+chapters) + `AsvsGrid` + AssessmentDetail + `asvsService` + section_type bugfix | create→grid renders, verdicts update live, manual override works |
| 5 | Reports: coverage section + FAIL table + colors | PDF shows ASVS coverage + FAILs as findings |
| 6 | (separate) Guidance enrichment for 345 reqs | reviewed JSON committed; rows show "Méthode suggérée" |

## 9. Risks / open notes

- **Whitebox coverage**: many L2/L3 reqs are code/config review — the agent will mark a lot `NA`/needs-source. The preprompt must make this explicit so it doesn't fake verdicts. `test_type` (from §7) is the main mitigation.
- **Re-seeding semantics**: if a user later widens level/chapters, we need an idempotent "add missing rows" path (a `POST …/asvs/seed` endpoint can be added in phase 2 if desired). Not in v1 scope unless you want it.
- **ASVS version bumps**: `asvs_version` column + versioned JSON make future v5.x updates a data swap, not a schema change.
- **Existing assessments** are untouched (`methodology` defaults to `"standard"`); the grid only appears for ASVS ones.

## 10. Out of scope (this iteration)

- Per-requirement multi-finding linking (decision ① keeps it self-contained).
- Editing the ASVS preprompt from the Settings UI (would need a new settings key + textarea; not requested).
- Mapping ASVS ↔ CWE/NIST (possible later via extra catalog columns).
