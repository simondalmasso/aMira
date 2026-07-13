// V6.1 risk-premium verification
// Confirms: ARRIESGADO > MODERADO > CONSERVADOR in projected gains

const EXPECTED_RETURNS_30D = {
  FCI: 0.020,
  PLAZO_FIJO: 0.022,
  BONOS: 0.025,
  CEDEARS: 0.027,
  ETF_CEDEARS: 0.028,
  ACCIONES: 0.030,
};

const STRESS_ADJUSTMENT = {
  CRISIS: 0.5,
  SIDEWAYS: 1.0,
  BULL: 1.4,
};

const BASE_WEIGHTS = {
  FCI: 0.30,
  PLAZO_FIJO: 0.20,
  ACCIONES: 0.15,
  BONOS: 0.05,
  CEDEARS: 0.15,
  ETF_CEDEARS: 0.15,
};

const RISK_FACTORS = {
  conservative: { FCI: 2.0, PLAZO_FIJO: 2.0, ACCIONES: 0.4, BONOS: 1.0, CEDEARS: 0.3, ETF_CEDEARS: 0.3 },
  balanced:     { FCI: 1.0, PLAZO_FIJO: 1.0, ACCIONES: 1.0, BONOS: 1.0, CEDEARS: 1.0, ETF_CEDEARS: 1.0 },
  aggressive:   { FCI: 0.4, PLAZO_FIJO: 0.3, ACCIONES: 2.0, BONOS: 0.5, CEDEARS: 2.5, ETF_CEDEARS: 2.0 },
};

const profiles = {
  CONSERVADOR: { risk: 0.15, label: 'conservative' },
  MODERADO:    { risk: 0.50, label: 'balanced' },
  ARRIESGADO:  { risk: 0.85, label: 'aggressive' },
};

const capital = 2000;

console.log('=== V6.1 RISK PREMIUM VERIFICATION ===');
console.log('Capital: $' + capital);
console.log('Stress: SIDEWAYS (adjustment ×1.0)');
console.log();
console.log('New EXPECTED_RETURNS_30D (per asset class, monthly):');
for (const [cls, r] of Object.entries(EXPECTED_RETURNS_30D)) {
  console.log(`  ${cls.padEnd(14)}: ${(r * 100).toFixed(2)}%/mo  (~${(r * 12 * 100).toFixed(0)}%/yr ARS)`);
}
console.log();

const results = {};
for (const [profileName, { label }] of Object.entries(profiles)) {
  const factors = RISK_FACTORS[label];
  // Compute normalized weights
  const pre = {};
  let sum = 0;
  for (const cls of Object.keys(BASE_WEIGHTS)) {
    pre[cls] = BASE_WEIGHTS[cls] * factors[cls];
    sum += pre[cls];
  }
  const weights = {};
  for (const cls of Object.keys(pre)) {
    weights[cls] = pre[cls] / sum;
  }

  // Compute baseline (SIDEWAYS, adjustment=1.0)
  const adjustment = STRESS_ADJUSTMENT.SIDEWAYS;
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

  results[profileName] = { ret30, ret60, ret90, profit30, profit60, profit90, weights };

  console.log(`--- ${profileName} (risk label: ${label}) ---`);
  console.log(`  Weights: FCI ${(weights.FCI * 100).toFixed(1)}%, PF ${(weights.PLAZO_FIJO * 100).toFixed(1)}%, ACC ${(weights.ACCIONES * 100).toFixed(1)}%, BONOS ${(weights.BONOS * 100).toFixed(1)}%, CED ${(weights.CEDEARS * 100).toFixed(1)}%, ETF ${(weights.ETF_CEDEARS * 100).toFixed(1)}%`);
  console.log(`  30d: ret=${(ret30 * 100).toFixed(4)}%  profit=+$${profit30.toFixed(2)}`);
  console.log(`  60d: ret=${(ret60 * 100).toFixed(4)}%  profit=+$${profit60.toFixed(2)}`);
  console.log(`  90d: ret=${(ret90 * 100).toFixed(4)}%  profit=+$${profit90.toFixed(2)}`);
  console.log();
}

console.log('=== ORDERING CHECK (should be ARRIESGADO > MODERADO > CONSERVADOR) ===');
const order30 = Object.entries(results).sort((a, b) => b[1].profit30 - a[1].profit30);
console.log('30d profit ordering (high → low):');
order30.forEach(([name, r], i) => console.log(`  ${i + 1}. ${name}: +$${r.profit30.toFixed(2)} (${(r.ret30 * 100).toFixed(2)}%)`));

const expected30 = ['ARRIESGADO', 'MODERADO', 'CONSERVADOR'];
const actual30 = order30.map(([n]) => n);
const ok30 = JSON.stringify(actual30) === JSON.stringify(expected30);
console.log(`\n30d: ${ok30 ? '✅ CORRECT (riskier = higher gain)' : '❌ WRONG'}`);

const order90 = Object.entries(results).sort((a, b) => b[1].profit90 - a[1].profit90);
const actual90 = order90.map(([n]) => n);
const ok90 = JSON.stringify(actual90) === JSON.stringify(expected30);
console.log(`90d: ${ok90 ? '✅ CORRECT' : '❌ WRONG'}`);

console.log();
console.log('=== COMPARISON WITH USER REPORTED (V6 broken) ===');
console.log('User reported V6 SIDEWAYS 30d:');
console.log(`  Panel 1 (likely CONSERVADOR): $41.23 / +2.06%  ← WRONG: highest`);
console.log(`  Panel 2 (likely MODERADO/ARRIESGADO): $33.58 / +1.68%  ← WRONG: lower`);
console.log();
console.log('V6.1 expected SIDEWAYS 30d:');
console.log(`  CONSERVADOR: +$${results.CONSERVADOR.profit30.toFixed(2)} / +${(results.CONSERVADOR.ret30 * 100).toFixed(2)}%  ← LOWEST`);
console.log(`  MODERADO:    +$${results.MODERADO.profit30.toFixed(2)} / +${(results.MODERADO.ret30 * 100).toFixed(2)}%  ← MIDDLE`);
console.log(`  ARRIESGADO:  +$${results.ARRIESGADO.profit30.toFixed(2)} / +${(results.ARRIESGADO.ret30 * 100).toFixed(2)}%  ← HIGHEST ✓`);
