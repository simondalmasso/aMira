-- ============================================================================
-- Ω-MYTHOS_X10_ENGINE — D1 Schema for Cloudflare Worker
-- Santander Argentina Macro Oracle
-- ============================================================================

-- Decision log — every X10 engine allocation decision
CREATE TABLE IF NOT EXISTS decisions_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  decision_type TEXT NOT NULL,           -- ALLOCATION_COMPUTED, REGIME_TRANSITION, etc.
  severity TEXT NOT NULL DEFAULT 'info', -- info, warning, critical
  summary TEXT NOT NULL,
  action TEXT NOT NULL,
  reasoning_json TEXT NOT NULL,           -- JSON array
  context_json TEXT NOT NULL,             -- Full decision context
  data_quality TEXT NOT NULL,             -- REAL, PARTIAL_FALLBACK, STALE, ERROR
  confidence REAL NOT NULL,               -- [0, 1]
  regime TEXT NOT NULL,                   -- CRISIS, HIGH_VOL, NORMAL, CARRY_FAVORABLE
  active_directives_json TEXT NOT NULL DEFAULT '[]',
  outcome_json TEXT,                      -- Filled later
  related_decisions_json TEXT DEFAULT '[]'
);

-- Macro state snapshots — cached from external APIs
CREATE TABLE IF NOT EXISTS macro_snapshots (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL,                  -- BCRA, INDEC, Bluelytics, etc.
  data_label TEXT NOT NULL,              -- REAL, PARTIAL_FALLBACK, STALE, ERROR
  mep_rate REAL,
  official_rate REAL,
  mep_gap REAL,
  inflation_monthly REAL,
  inflation_expected30d REAL,
  bcra_policy_rate REAL,
  money_market_tna REAL,
  plazo_fijo_tna REAL,
  plazo_fijo_uva_premium REAL,
  lecaps_tna REAL,
  badlar_tna REAL,
  leliq_tna REAL,
  cer_index REAL,
  cer_monthly_change REAL,
  crawling_peg REAL,
  reserves_millions REAL,
  real_data_pct REAL DEFAULT 0,
  raw_json TEXT,                         -- Raw API response
  staleness_hours REAL DEFAULT 0,
  fetch_error INTEGER DEFAULT 0
);

-- Backtest results
CREATE TABLE IF NOT EXISTS backtest_results (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  mode TEXT NOT NULL,                    -- CONSERVATIVE, MODERATE, AGGRESSIVE
  capital_usd REAL NOT NULL,
  seed INTEGER NOT NULL,                 -- Deterministic seed used
  total_scenarios INTEGER NOT NULL,
  regime_accuracy REAL NOT NULL,
  avg_return_error REAL NOT NULL,
  max_drawdown REAL NOT NULL,
  within_bounds_rate REAL NOT NULL,
  capital_preservation_rate REAL NOT NULL,
  emergency_freeze_rate REAL NOT NULL,
  cumulative_pnl REAL NOT NULL,
  assessment TEXT NOT NULL,              -- VALIDATION_PASSED, MARGINAL, FAILED, INSUFFICIENT_DATA
  results_json TEXT NOT NULL,
  duration_ms INTEGER NOT NULL
);

-- Regime history — time series
CREATE TABLE IF NOT EXISTS regime_history (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  regime TEXT NOT NULL,
  confidence REAL NOT NULL,
  data_quality TEXT NOT NULL,
  mep_rate REAL,
  inflation_monthly REAL,
  bcra_policy_rate REAL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON decisions_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_decisions_regime ON decisions_log(regime);
CREATE INDEX IF NOT EXISTS idx_decisions_type ON decisions_log(decision_type);
CREATE INDEX IF NOT EXISTS idx_macro_timestamp ON macro_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_backtest_timestamp ON backtest_results(timestamp);
CREATE INDEX IF NOT EXISTS idx_regime_timestamp ON regime_history(timestamp);
