// V6 fallback math verification
// Replicates exactly what decisionEngineCore() does in the fallback path
// Uses the MODERADO profile canonical weights to verify expected gains

const EXPECTED_RETURNS_30D = {
  FCI: 0.020,
  PLAZO_FIJO: 0.025,
  ACCIONES: 0.015,
  BONOS: 0.022,
  CEDEARS: 0.008,
  ETF_CEDEARS: 0.010,
};

const STRESS_ADJUSTMENT = {
  CRISIS: 0.5,
  SIDEWAYS: 1.0,
  BULL: 1.4,
};

// MODERADO profile canonical weights (risk=0.50, balanced)
// Derived from BASE_WEIGHTS × RISK_FACTORS.balanced = BASE_WEIGHTS (factor=1.0)
// → normalized to sum=1
const BASE_WEIGHTS = {
  FCI: 0.30,
  PLAZO_FIJO: 0.20,
  ACCIONES: 0.15,
  BONOS: 0.05,
  CEDEARS: 0.15,
  ETF_CEDEARS: 0.15,
};

const totalBase = Object.values(BASE_WEIGHTS).reduce((a, b) => a + b, 0);
const weights = {};
for (const [k, v] of Object.entries(BASE_WEIGHTS)) {
  weights[k] = v / totalBase;
}

const capital = 2000;

console.log('=== V6 Fallback Math Verification ===');
console.log(`Capital: $${capital}`);
console.log(`Profile: MODERADO (balanced, risk=0.50)`);
console.log(`Weights (normalized):`, weights);
console.log();

for (const stress of ['CRISIS', 'SIDEWAYS', 'BULL']) {
  const adjustment = STRESS_ADJUSTMENT[stress];

  // ret_30d = adjustment × Σ(w_i × EXPECTED_RETURNS_30D[class_i]) / Σw_i
  let weightedBaseline = 0;
  let wSum = 0;
  for (const [cls, w] of Object.entries(weights)) {
    weightedBaseline += w * EXPECTED_RETURNS_30D[cls];
    wSum += w;
  }
  const ret30 = adjustment * (weightedBaseline / wSum);
  const ret60 = Math.pow(1 + ret30, 2) - 1;
  const ret90 = Math.pow(1 + ret30, 3) - 1;

  const profit30 = ret30 * capital;
  const profit60 = ret60 * capital;
  const profit90 = ret90 * capital;

  console.log(`--- ${stress} (adjustment ×${adjustment}) ---`);
  console.log(`  30d: ret=${(ret30 * 100).toFixed(4)}%  profit=+$${profit30.toFixed(2)}`);
  console.log(`  60d: ret=${(ret60 * 100).toFixed(4)}%  profit=+$${profit60.toFixed(2)}`);
  console.log(`  90d: ret=${(ret90 * 100).toFixed(4)}%  profit=+$${profit90.toFixed(2)}`);
  console.log();
}

console.log('=== V5 (old, for comparison) ===');
const STRESS_SHOCKS = {
  CRISIS:    { FCI: -0.10, PLAZO_FIJO: 0.03, ACCIONES: -0.18, BONOS: 0.03, CEDEARS: -0.18, ETF_CEDEARS: -0.18 },
  SIDEWAYS:  { FCI: 0.00,  PLAZO_FIJO: 0.02, ACCIONES: -0.02, BONOS: 0.02, CEDEARS: -0.02, ETF_CEDEARS: -0.02 },
  BULL:      { FCI: 0.06,  PLAZO_FIJO: 0.02, ACCIONES: 0.12,  BONOS: 0.02, CEDEARS: 0.12,  ETF_CEDEARS: 0.12 },
};

for (const stress of ['CRISIS', 'SIDEWAYS', 'BULL']) {
  const shocks = STRESS_SHOCKS[stress];
  let fallback30 = 0;
  let wSum = 0;
  for (const [cls, w] of Object.entries(weights)) {
    fallback30 += w * (shocks[cls] ?? 0);
    wSum += w;
  }
  const ret30 = fallback30 / wSum;
  const profit30 = ret30 * capital;
  console.log(`V5 ${stress}: 30d ret=${(ret30 * 100).toFixed(4)}%  profit=${profit30 >= 0 ? '+' : ''}$${profit30.toFixed(2)}`);
}

console.log();
console.log('=== EXPECTED post-V6 in dashboard ===');
console.log('User reported (V5 SIDEWAYS): -$10.53 / -$21.00 / -$31.58');
console.log('V6 SIDEWAYS expected:       +$34.10 / +$68.69 / +$103.83');
