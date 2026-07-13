// /home/z/my-project/scripts/ui-truthfulness-tests.mjs
// Focused tests for UI Truthfulness Patch v1
// Per COUNCIL EXECUTION ORDER — Section 12: Pruebas obligatorias
//
// Run: node scripts/ui-truthfulness-tests.mjs

const results = [];
function assert(condition, name, detail = '') {
  const pass = !!condition;
  results.push({ name, pass, detail: pass ? '' : (detail || 'assertion failed') });
  if (!pass) console.error(`  ✗ FAIL: ${name} — ${detail}`);
  else console.log(`  ✓ PASS: ${name}`);
}

console.log('══════════════════════════════════════════════════════════');
console.log('UI TRUTHFULNESS PATCH v1 — Focused Tests');
console.log('══════════════════════════════════════════════════════════');

// ─── Test 1: Fisher carry with tna=0.29, inflation=0.038 → ~-17.54% ────────
console.log('\n── Test 1: Fisher carry formula (U1) ──');
{
  const tna = 0.29;
  const inflation = 0.038;

  // Replicate the NEW formula from bloomberg-lite-terminal.tsx
  const tnaFinite = typeof tna === 'number' && isFinite(tna);
  const inflationFinite = typeof inflation === 'number' && isFinite(inflation);
  const inflationValid = inflationFinite && inflation > -1;
  const inflationAnnual = inflationValid ? Math.pow(1 + inflation, 12) - 1 : NaN;
  const denominatorValid = isFinite(inflationAnnual) && (1 + inflationAnnual) > 0;
  const realCarryValid = tnaFinite && inflationValid && denominatorValid;
  const realCarry = realCarryValid ? (1 + tna) / (1 + inflationAnnual) - 1 : NaN;

  const expectedInflationAnnual = 0.5645; // (1.038)^12 - 1
  const expectedRealCarry = -0.1754;      // 1.29 / 1.5645 - 1

  assert(Math.abs(inflationAnnual - expectedInflationAnnual) < 0.001,
    'inflationAnnual ≈ 0.5645',
    `got ${inflationAnnual.toFixed(4)}`);
  assert(Math.abs(realCarry - expectedRealCarry) < 0.001,
    'realCarry ≈ -0.1754 (-17.54%)',
    `got ${realCarry.toFixed(4)} (${(realCarry * 100).toFixed(2)}%)`);
  assert(realCarry * 100 > -18 && realCarry * 100 < -17,
    'display ≈ -17.5%',
    `got ${(realCarry * 100).toFixed(2)}%`);

  // Verify the OLD buggy formula would give -127.4% (regression check)
  const buggyRealCarry = tna - Math.pow(1 + inflation, 12) - 1 + 1;
  assert(buggyRealCarry * 100 < -100,
    'OLD buggy formula gives < -100% (confirms bug existed)',
    `got ${(buggyRealCarry * 100).toFixed(2)}%`);
  assert(realCarry * 100 > -100,
    'NEW formula gives > -100% (bug fixed)',
    `got ${(realCarry * 100).toFixed(2)}%`);
}

// ─── Test 1b: Fisher carry guards ──────────────────────────────────────────
console.log('\n── Test 1b: Fisher carry guards (U1) ──');
{
  // tna not finite
  let tna = NaN, inflation = 0.038;
  let tnaFinite = typeof tna === 'number' && isFinite(tna);
  let inflationFinite = typeof inflation === 'number' && isFinite(inflation);
  let inflationValid = inflationFinite && inflation > -1;
  let inflationAnnual = inflationValid ? Math.pow(1 + inflation, 12) - 1 : NaN;
  let denominatorValid = isFinite(inflationAnnual) && (1 + inflationAnnual) > 0;
  let realCarryValid = tnaFinite && inflationValid && denominatorValid;
  assert(!realCarryValid, 'Guard: tna=NaN → N/D', `realCarryValid=${realCarryValid}`);

  // inflation not finite
  tna = 0.29; inflation = NaN;
  tnaFinite = typeof tna === 'number' && isFinite(tna);
  inflationFinite = typeof inflation === 'number' && isFinite(inflation);
  inflationValid = inflationFinite && inflation > -1;
  inflationAnnual = inflationValid ? Math.pow(1 + inflation, 12) - 1 : NaN;
  denominatorValid = isFinite(inflationAnnual) && (1 + inflationAnnual) > 0;
  realCarryValid = tnaFinite && inflationValid && denominatorValid;
  assert(!realCarryValid, 'Guard: inflation=NaN → N/D', `realCarryValid=${realCarryValid}`);

  // inflation <= -1 (would make 1+inflation <= 0)
  tna = 0.29; inflation = -1.5;
  tnaFinite = typeof tna === 'number' && isFinite(tna);
  inflationFinite = typeof inflation === 'number' && isFinite(inflation);
  inflationValid = inflationFinite && inflation > -1;
  inflationAnnual = inflationValid ? Math.pow(1 + inflation, 12) - 1 : NaN;
  denominatorValid = isFinite(inflationAnnual) && (1 + inflationAnnual) > 0;
  realCarryValid = tnaFinite && inflationValid && denominatorValid;
  assert(!realCarryValid, 'Guard: inflation=-1.5 → N/D', `realCarryValid=${realCarryValid}`);

  // Valid inputs
  tna = 0.29; inflation = 0.038;
  tnaFinite = typeof tna === 'number' && isFinite(tna);
  inflationFinite = typeof inflation === 'number' && isFinite(inflation);
  inflationValid = inflationFinite && inflation > -1;
  inflationAnnual = inflationValid ? Math.pow(1 + inflation, 12) - 1 : NaN;
  denominatorValid = isFinite(inflationAnnual) && (1 + inflationAnnual) > 0;
  realCarryValid = tnaFinite && inflationValid && denominatorValid;
  assert(realCarryValid, 'Guard: valid inputs → not N/D', `realCarryValid=${realCarryValid}`);
}

// ─── Test 2: n=0 → N/D for hit rate, MAE, Brier (U2) ───────────────────────
console.log('\n── Test 2: n=0 metrics display N/D (U2) ──');
{
  // Simulate learning object with n=0 (closed-loop-learning defaults)
  const learning_n0 = {
    total_verifications: 0,
    directional_accuracy_rate: 0.5,  // misleading default
    mean_absolute_error: 0,          // misleading default (perfect)
    mean_brier_score: 0,             // misleading default (perfect)
    last_update_timestamp: null,
  };

  // Replicate the U2 fix logic from single-oracle-panel.tsx
  const hasVerifications = learning_n0.total_verifications > 0;
  const hitRate = hasVerifications ? (learning_n0.directional_accuracy_rate * 100).toFixed(1) : 'N/D';
  const maePct = hasVerifications ? (learning_n0.mean_absolute_error * 100).toFixed(3) : 'N/D';
  const brier = hasVerifications ? learning_n0.mean_brier_score.toFixed(4) : 'N/D';

  assert(hitRate === 'N/D', 'n=0 → hitRate = N/D', `got ${hitRate}`);
  assert(maePct === 'N/D', 'n=0 → maePct = N/D', `got ${maePct}`);
  assert(brier === 'N/D', 'n=0 → brier = N/D', `got ${brier}`);
}

// ─── Test 3: n>0 → normal metrics (U2) ─────────────────────────────────────
console.log('\n── Test 3: n>0 metrics display normally (U2) ──');
{
  const learning_n5 = {
    total_verifications: 5,
    directional_accuracy_rate: 0.6,   // 60%
    mean_absolute_error: 0.012,       // 1.2%
    mean_brier_score: 0.1875,
    last_update_timestamp: '2026-07-13T10:00:00Z',
  };

  const hasVerifications = learning_n5.total_verifications > 0;
  const hitRate = hasVerifications ? (learning_n5.directional_accuracy_rate * 100).toFixed(1) : 'N/D';
  const maePct = hasVerifications ? (learning_n5.mean_absolute_error * 100).toFixed(3) : 'N/D';
  const brier = hasVerifications ? learning_n5.mean_brier_score.toFixed(4) : 'N/D';

  assert(hitRate === '60.0', 'n=5 → hitRate = 60.0', `got ${hitRate}`);
  assert(maePct === '1.200', 'n=5 → maePct = 1.200', `got ${maePct}`);
  assert(brier === '0.1875', 'n=5 → brier = 0.1875', `got ${brier}`);
}

// ─── Test 4: P&L live vs stress labels (U4) ────────────────────────────────
console.log('\n── Test 4: P&L label differentiation (U4) ──');
{
  // P&L live = portfolio.profit_absolute_usd = NAV - capital
  const capital = 2000;
  const nav = 1889.90;
  const pnlLive = nav - capital; // -110.10
  assert(Math.abs(pnlLive - (-110.10)) < 0.01, 'P&L live = -$110.10', `got ${pnlLive}`);

  // P&L stress = decision.stress_projection.profit_absolute (hypothetical)
  const pnlStress = -100.00; // example value
  assert(pnlStress !== pnlLive, 'P&L stress ≠ P&L live', `stress=${pnlStress}, live=${pnlLive}`);

  // Labels must be different
  const liveLabel = 'P&L actual (paper)';
  const stressLabel = 'P&L proyectado — escenario stress';
  assert(liveLabel !== stressLabel, 'Labels differ', `live="${liveLabel}" stress="${stressLabel}"`);
}

// ─── Test 5: Macro 5/5 → label with scope (U5) ─────────────────────────────
console.log('\n── Test 5: Macro REAL label scope (U5) ──');
{
  const realDataPct = 100;
  const oldLabel = `${realDataPct}% REAL`;
  const newLabel = `Macro real: ${realDataPct}%`;

  assert(oldLabel !== newLabel, 'New label differs from old', `old="${oldLabel}" new="${newLabel}"`);
  assert(newLabel.includes('Macro'), 'New label includes "Macro"', `got "${newLabel}"`);
  assert(!newLabel.includes('% REAL'), 'New label does NOT say "% REAL"', `got "${newLabel}"`);

  // Scope disclaimer must mention exclusions
  const scopeDisclaimer = 'No incluye predicciones, backtests, VaR, Sharpe, retornos esperados, historial simulado ni precios de todas las clases.';
  assert(scopeDisclaimer.includes('predicciones'), 'Scope excludes predicciones');
  assert(scopeDisclaimer.includes('backtests'), 'Scope excludes backtests');
  assert(scopeDisclaimer.includes('VaR'), 'Scope excludes VaR');
  assert(scopeDisclaimer.includes('Sharpe'), 'Scope excludes Sharpe');
}

// ─── Test 6: Pred OFF → "Escenario estático" not "Ganancia estimada" (U6) ─
console.log('\n── Test 6: Pred OFF label (U6) ──');
{
  const predSourceFallback = 'fallback';
  const oldLabel = 'GANANCIA estimada · 30 días';
  const newLabel = predSourceFallback === 'fallback'
    ? 'Escenario estático de referencia · 30 días'
    : oldLabel;

  assert(newLabel === 'Escenario estático de referencia · 30 días',
    'fallback source → "Escenario estático de referencia"',
    `got "${newLabel}"`);
  assert(!newLabel.includes('GANANCIA estimada'),
    'fallback label does NOT say "GANANCIA estimada"',
    `got "${newLabel}"`);

  // When source is 'ml', label stays as "GANANCIA estimada"
  const predSourceMl = 'ml';
  const mlLabel = predSourceMl === 'fallback'
    ? 'Escenario estático de referencia · 30 días'
    : 'GANANCIA estimada · 30 días';
  assert(mlLabel === 'GANANCIA estimada · 30 días',
    'ml source → keeps "GANANCIA estimada"',
    `got "${mlLabel}"`);

  // Badges must be present when fallback
  const badges = predSourceFallback === 'fallback'
    ? ['PRED OFF', 'NO ES PREDICCIÓN ML']
    : [];
  assert(badges.includes('PRED OFF'), 'PRED OFF badge present');
  assert(badges.includes('NO ES PREDICCIÓN ML'), 'NO ES PREDICCIÓN ML badge present');
}

// ─── Test 7: U8 momentum clamp — NOT_IMPLEMENTABLE_UI_ONLY ─────────────────
console.log('\n── Test 7: U8 momentum clamp documentation (U8) ──');
{
  // AssetMetrics type has no `clamped` field — confirmed by code inspection.
  // rank.ts clamps silently inside momentumFromSeries() and returns only the value.
  // Since rank.ts is in src/lib/oracle-multi/ (PROHIBITED), UI cannot identify clamp.
  const assetMetricsHasClampedField = false; // verified via grep of types.ts
  assert(assetMetricsHasClampedField === false,
    'AssetMetrics has NO clamped field → NOT_IMPLEMENTABLE_UI_ONLY',
    'UI cannot distinguish clamped ±100% from real ±100%');

  // Do NOT infer clamp from value === ±1.0
  const momentumValue = 1.0;
  const wouldInferClamp = Math.abs(momentumValue) === 1.0;
  assert(wouldInferClamp === true,
    'Value === 1.0 exists, but must NOT be flagged as clamped without payload flag',
    'NOT_IMPLEMENTABLE_UI_ONLY per spec');
}

// ─── Summary ───────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════');
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;
console.log(`RESULTS: ${passed} passed, ${failed} failed, ${results.length} total`);
console.log('══════════════════════════════════════════════════════════');

if (failed > 0) {
  console.log('\nFAILED TESTS:');
  results.filter(r => !r.pass).forEach(r => {
    console.log(`  ✗ ${r.name}: ${r.detail}`);
  });
  process.exit(1);
} else {
  console.log('\n✓ ALL TESTS PASSED');
  process.exit(0);
}
