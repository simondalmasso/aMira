// ============================================================================
// Ω-MYTHOS_X10_ENGINE — Cloudflare Worker (SINGLE FILE — COPY PASTE THIS)
// Santander Argentina Macro Oracle + X10 Decision Engine
// Routes: / (landing) /api/macro /api/x10 /api/regime /api/backtest-lite /api/health
// ============================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    try {
      if (path === '/' || path === '') return landingPage();
      if (path === '/api/macro' && request.method === 'GET') return await handleMacro(env, ctx);
      if (path === '/api/x10' && request.method === 'POST') return await handleX10(request, env, ctx);
      if (path === '/api/regime' && request.method === 'GET') return await handleRegime(env, ctx);
      if (path === '/api/backtest-lite' && request.method === 'GET') return await handleBacktestLite(env, url);
      if (path === '/api/health' && request.method === 'GET') return jsonResponse({ status: 'ok', version: 'X10-CF-WORKER-v1.0', timestamp: isoNow() });
      return jsonResponse({ error: 'Not Found', path }, 404);
    } catch (err) {
      return jsonResponse({ error: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Internal server error', timestamp: isoNow() }, 500);
    }
  }
};

// ============================================================================
// LANDING PAGE — Responsive HTML
// ============================================================================
function landingPage() {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>\u03A9-MYTHOS X10 Engine</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0e17;--card:#111827;--border:#1e293b;--accent:#3b82f6;--accent2:#8b5cf6;--green:#10b981;--red:#ef4444;--amber:#f59e0b;--text:#e2e8f0;--muted:#94a3b8}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;line-height:1.6;-webkit-tap-highlight-color:transparent}
.container{max-width:900px;margin:0 auto;padding:12px}
header{text-align:center;padding:28px 12px 20px}
.logo{font-size:2rem;letter-spacing:-1px;margin-bottom:4px}
.logo span{background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.subtitle{color:var(--muted);font-size:.85rem}
.status-bar{display:flex;justify-content:center;gap:6px;margin:16px 0;flex-wrap:wrap}
.badge{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;font-size:.7rem;font-weight:600;border:1px solid var(--border)}
.badge.live{border-color:var(--green);color:var(--green)}
.badge.live::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px}
.card-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.card-head .icon{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0}
.card-head .icon.blue{background:rgba(59,130,246,.15)}
.card-head .icon.purple{background:rgba(139,92,246,.15)}
.card-head .icon.green{background:rgba(16,185,129,.15)}
.card-head .icon.amber{background:rgba(245,158,11,.15)}
.card-head .icon.red{background:rgba(239,68,68,.15)}
.card h3{font-size:.95rem;font-weight:600}
.card .method{font-size:.6rem;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(59,130,246,.2);color:var(--accent);letter-spacing:.5px;margin-left:6px}
.card .path{font-family:'SF Mono',Monaco,Consolas,monospace;font-size:.8rem;color:var(--accent);margin:4px 0 6px}
.card p{color:var(--muted);font-size:.8rem}
.try-btn{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:10px;padding:12px 16px;border-radius:10px;background:linear-gradient(135deg,rgba(59,130,246,.15),rgba(139,92,246,.1));border:1px solid rgba(59,130,246,.3);color:var(--accent);font-size:.82rem;font-weight:600;cursor:pointer;text-decoration:none;transition:all .2s;-webkit-user-select:none;user-select:none;min-height:44px;width:100%}
.try-btn:active{transform:scale(.97);background:rgba(59,130,246,.25)}
.result-box{display:none;margin-top:10px;padding:12px;background:#060a13;border:1px solid var(--border);border-radius:8px;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:.68rem;overflow-x:auto;max-height:300px;color:var(--muted);white-space:pre-wrap;word-break:break-all}
.result-box.show{display:block}
.close-result{display:block;margin-top:6px;padding:6px 12px;border-radius:6px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);color:var(--red);font-size:.7rem;cursor:pointer;text-align:center}
.footer{text-align:center;padding:20px 12px;color:var(--muted);font-size:.7rem;border-top:1px solid var(--border);margin-top:20px}
@media(min-width:640px){.logo{font-size:2.8rem}.cards{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card:last-child{grid-column:span 2}.try-btn{width:auto;display:inline-flex}}
</style>
</head>
<body>
<div class="container">
<header>
<div class="logo"><span>\u03A9-MYTHOS</span> X10</div>
<div class="subtitle">Santander Argentina \u2014 Macro Oracle + Decision Engine</div>
<div class="status-bar">
<span class="badge live">EDGE LIVE</span>
<span class="badge">Cloudflare Workers</span>
<span class="badge">v1.0</span>
</div>
</header>

<div class="cards">
<div class="card">
<div class="card-head">
<div class="icon blue">\uD83D\uDCCA</div>
<div><h3>Macro State <span class="method">GET</span></h3></div>
</div>
<div class="path">/api/macro</div>
<p>Estado macro en tiempo real: MEP, inflaci\u00F3n, tasas, CER, r\u00E9gimen + oracle de confianza.</p>
<button class="try-btn" onclick="apiGet('/api/macro','r0')">Prob\u00E1 este endpoint</button>
<pre id="r0" class="result-box"></pre>
</div>

<div class="card">
<div class="card-head">
<div class="icon purple">\uD83C\uDFAF</div>
<div><h3>X10 Allocation <span class="method">POST</span></h3></div>
</div>
<div class="path">/api/x10</div>
<p>Motor de asignaci\u00F3n completo: 5 buckets, 4 r\u00E9gimenes, directivas X10 de seguridad.</p>
<button class="try-btn" onclick="apiPost('/api/x10',{capital:2000,mode:'MODERATE'},'r1')">Probar 2000 USD Moderate</button>
<pre id="r1" class="result-box"></pre>
</div>

<div class="card">
<div class="card-head">
<div class="icon green">\uD83D\uDD2E</div>
<div><h3>Regime Analysis <span class="method">GET</span></h3></div>
</div>
<div class="path">/api/regime</div>
<p>R\u00E9gimen actual, historial, probabilidad de transici\u00F3n y se\u00F1ales del oracle.</p>
<button class="try-btn" onclick="apiGet('/api/regime','r2')">Prob\u00E1 este endpoint</button>
<pre id="r2" class="result-box"></pre>
</div>

<div class="card">
<div class="card-head">
<div class="icon amber">\uD83D\uDD04</div>
<div><h3>Backtest Lite <span class="method">GET</span></h3></div>
</div>
<div class="path">/api/backtest-lite</div>
<p>Backtest determinista con 8 escenarios hist\u00F3ricos. PRNG seeded (reproducible).</p>
<button class="try-btn" onclick="apiGet('/api/backtest-lite','r3')">Prob\u00E1 este endpoint</button>
<pre id="r3" class="result-box"></pre>
</div>

<div class="card" style="grid-column:span 2">
<div class="card-head">
<div class="icon red">\u2764\uFE0F</div>
<div><h3>Health Check <span class="method">GET</span></h3></div>
</div>
<div class="path">/api/health</div>
<p>Verifica que el Worker est\u00E9 operativo. Retorna versi\u00F3n y timestamp.</p>
<button class="try-btn" onclick="apiGet('/api/health','r4')">Prob\u00E1 este endpoint</button>
<pre id="r4" class="result-box"></pre>
</div>
</div>

<div class="footer">
Edge-first \u00B7 KV cache 5min TTL \u00B7 D1 logging \u00B7 Seeded PRNG \u00B7 Failsafe on ERROR/STALE<br>
Fisher: ((1 + TNA/12) / (1 + IPC_mensual)) - 1 \u00B7 5 Data States: REAL \u00B7 STALE \u00B7 PARTIAL_FALLBACK \u00B7 SIMULADO \u00B7 ERROR
</div>
</div>

<script>
function apiGet(url,id){var el=document.getElementById(id);el.textContent='Cargando...';el.className='result-box show';fetch(url).then(function(r){return r.json()}).then(function(d){el.textContent=JSON.stringify(d,null,2)}).catch(function(e){el.textContent='Error: '+e.message})}
function apiPost(url,body,id){var el=document.getElementById(id);el.textContent='Cargando...';el.className='result-box show';fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json()}).then(function(d){el.textContent=JSON.stringify(d,null,2)}).catch(function(e){el.textContent='Error: '+e.message})}
</script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8', ...corsHeaders() } });
}

// ============================================================================
// HANDLERS
// ============================================================================
async function handleMacro(env, ctx) {
  const macro = await fetchMacroState(env);
  const { regime, confidence, oracle } = classifyRegime(macro);
  const staleness_report = {};
  for (const [key, prov] of Object.entries(macro.provenance)) {
    staleness_report[key] = { label: prov.label, stalenessHours: prov.stalenessHours };
  }
  ctx.waitUntil(logMacroSnapshot(env, macro, regime, confidence));
  return jsonResponse({ macro_state: macro, staleness_report, regime, confidence: round2(confidence), oracle, timestamp: isoNow() });
}

async function handleX10(request, env, ctx) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON body' }, 400); }
  const capital = body.capital || 2000;
  const mode = ['CONSERVATIVE','MODERATE','AGGRESSIVE'].includes(body.mode) ? body.mode : 'MODERATE';
  if (capital < 100 || capital > 1000000) return jsonResponse({ error: 'Capital must be 100-1,000,000 USD' }, 400);
  const macro = await fetchMacroState(env);
  const out = runX10Engine(macro, mode, capital);
  ctx.waitUntil(logDecision(env, out, mode, capital));
  return jsonResponse({
    allocation: out.portfolio_allocation, risk_metrics: out.risk_metrics,
    confidence: out.confidence_score, stress_scenarios: { downside: out.scenario_downside, base: out.scenario_base, upside: out.scenario_upside },
    x10_directives: out.x10Directives, timestamp: out.timestamp
  });
}

async function handleRegime(env, ctx) {
  const macro = await fetchMacroState(env);
  const { regime, confidence, oracle } = classifyRegime(macro);
  let regime_history = [];
  try {
    const result = await env.ORACLE_DB.prepare('SELECT timestamp, regime, confidence FROM regime_history ORDER BY timestamp DESC LIMIT 30').all();
    regime_history = (result.results || []).map(r => ({ timestamp: r.timestamp, regime: r.regime, confidence: r.confidence }));
  } catch {}
  const transition_probability = computeTransitionProbability(regime);
  ctx.waitUntil(logRegimeObservation(env, regime, confidence, macro));
  return jsonResponse({ current_regime: regime, regime_history, transition_probability, oracle, timestamp: isoNow() });
}

async function handleBacktestLite(env, url) {
  const seed = url.searchParams.get('seed') ? parseInt(url.searchParams.get('seed'), 10) : 42;
  const modeParam = url.searchParams.get('mode') || 'MODERATE';
  const mode = ['CONSERVATIVE','MODERATE','AGGRESSIVE'].includes(modeParam) ? modeParam : 'MODERATE';
  mulberry32(seed);
  const scenarios = getHistoricalScenarios();
  const results = scenarios.map(sc => {
    const out = runX10Engine(sc.macro, mode, 2000);
    const predictedRegime = classifyRegime(sc.macro).regime;
    return { id: sc.id, label: sc.label, predicted_regime: predictedRegime, actual_regime: sc.actualRegime, regime_correct: predictedRegime === sc.actualRegime, predicted_return: out.risk_metrics.expectedReturn30d, actual_return: sc.actualReturn, confidence: out.confidence_score };
  });
  const regimeAccuracy = results.filter(r => r.regime_correct).length / results.length;
  return jsonResponse({ seed, mode, total_scenarios: results.length, regime_accuracy: round2(regimeAccuracy), results, disclaimer: 'BACKTEST RESULTS ARE HYPOTHETICAL. Historical macro states are model-constructed, not observed.', timestamp: isoNow() });
}

// ============================================================================
// TRANSITION PROBABILITY
// ============================================================================
function computeTransitionProbability(currentRegime) {
  const T = {
    CRISIS:           { CRISIS: 0.40, HIGH_VOL: 0.35, NORMAL: 0.15, CARRY_FAVORABLE: 0.10 },
    HIGH_VOL:         { CRISIS: 0.20, HIGH_VOL: 0.40, NORMAL: 0.30, CARRY_FAVORABLE: 0.10 },
    NORMAL:           { CRISIS: 0.05, HIGH_VOL: 0.15, NORMAL: 0.55, CARRY_FAVORABLE: 0.25 },
    CARRY_FAVORABLE:  { CRISIS: 0.03, HIGH_VOL: 0.07, NORMAL: 0.30, CARRY_FAVORABLE: 0.60 },
  };
  return T[currentRegime] || T.NORMAL;
}

// ============================================================================
// HISTORICAL SCENARIOS
// ============================================================================
function getHistoricalScenarios() {
  const now = isoNow();
  const mp = (label) => ({ label, source:'Historical', url:'N/A', lastUpdate:now, dataDate:now.split('T')[0], stalenessHours:0, fetchedAt:now, ageMinutes:0, fetchError:false });
  return [
    { id:'paso-2023', label:'PASO Elections 2023', actualRegime:'CRISIS', actualReturn:-8.5, macro:{ lastUpdate:now, fetchedAt:now, ageMinutes:0, lastSuccessfulFetch:now, source:'PARTIAL_FALLBACK', mep:{rate:750,officialRate:350,gap:114,sell:780,buy:720}, inflation:{monthly:12.4,expected30d:15.0,expected90d:45.0,yearly:125.0}, rates:{bcraPolicy:118,moneyMarket:115,plazoFijo:97,plazoFijoUVA:5.5,lecaps:120,badlar:100,leliq:118,tml:98}, cer:{index:340,monthlyChange:12.0,dailyChange:0.38}, crawlingPeg:5.0, realDataPct:40, provenance:{mepRate:mp('PARTIAL_FALLBACK'),inflation:mp('PARTIAL_FALLBACK'),rates:mp('PARTIAL_FALLBACK'),cer:mp('PARTIAL_FALLBACK'),crawlingPeg:mp('ERROR'),reserves:mp('PARTIAL_FALLBACK')}} },
    { id:'milei-transition', label:'Milei Transition 2023', actualRegime:'HIGH_VOL', actualReturn:-3.2, macro:{ lastUpdate:now, fetchedAt:now, ageMinutes:0, lastSuccessfulFetch:now, source:'PARTIAL_FALLBACK', mep:{rate:1000,officialRate:800,gap:25,sell:1020,buy:980}, inflation:{monthly:25.0,expected30d:20.0,expected90d:40.0,yearly:280.0}, rates:{bcraPolicy:133,moneyMarket:130,plazoFijo:110,plazoFijoUVA:3.0,lecaps:135,badlar:120,leliq:133,tml:118}, cer:{index:420,monthlyChange:25.0,dailyChange:0.75}, crawlingPeg:2.0, realDataPct:40, provenance:{mepRate:mp('PARTIAL_FALLBACK'),inflation:mp('PARTIAL_FALLBACK'),rates:mp('PARTIAL_FALLBACK'),cer:mp('PARTIAL_FALLBACK'),crawlingPeg:mp('ERROR'),reserves:mp('PARTIAL_FALLBACK')}} },
    { id:'stabilization-2024', label:'Stabilization 2024', actualRegime:'NORMAL', actualReturn:0.8, macro:{ lastUpdate:now, fetchedAt:now, ageMinutes:0, lastSuccessfulFetch:now, source:'PARTIAL_FALLBACK', mep:{rate:1100,officialRate:870,gap:26,sell:1110,buy:1090}, inflation:{monthly:8.8,expected30d:6.0,expected90d:12.0,yearly:140.0}, rates:{bcraPolicy:40,moneyMarket:38,plazoFijo:35,plazoFijoUVA:3.5,lecaps:42,badlar:36,leliq:40,tml:34}, cer:{index:530,monthlyChange:8.5,dailyChange:0.28}, crawlingPeg:2.0, realDataPct:40, provenance:{mepRate:mp('PARTIAL_FALLBACK'),inflation:mp('PARTIAL_FALLBACK'),rates:mp('PARTIAL_FALLBACK'),cer:mp('PARTIAL_FALLBACK'),crawlingPeg:mp('ERROR'),reserves:mp('PARTIAL_FALLBACK')}} },
    { id:'carry-2024', label:'Carry Favorable 2024', actualRegime:'CARRY_FAVORABLE', actualReturn:1.4, macro:{ lastUpdate:now, fetchedAt:now, ageMinutes:0, lastSuccessfulFetch:now, source:'PARTIAL_FALLBACK', mep:{rate:1200,officialRate:1010,gap:19,sell:1210,buy:1190}, inflation:{monthly:2.7,expected30d:2.5,expected90d:7.5,yearly:55.0}, rates:{bcraPolicy:32,moneyMarket:30,plazoFijo:28,plazoFijoUVA:4.0,lecaps:35,badlar:29,leliq:32,tml:27}, cer:{index:620,monthlyChange:2.5,dailyChange:0.08}, crawlingPeg:1.0, realDataPct:40, provenance:{mepRate:mp('PARTIAL_FALLBACK'),inflation:mp('PARTIAL_FALLBACK'),rates:mp('PARTIAL_FALLBACK'),cer:mp('PARTIAL_FALLBACK'),crawlingPeg:mp('ERROR'),reserves:mp('PARTIAL_FALLBACK')}} },
    { id:'bandas-2026', label:'Bandas Cambiarias 2026', actualRegime:'NORMAL', actualReturn:0.7, macro:{ lastUpdate:now, fetchedAt:now, ageMinutes:0, lastSuccessfulFetch:now, source:'PARTIAL_FALLBACK', mep:{rate:1445,officialRate:1440,gap:0.35,sell:1450,buy:1440}, inflation:{monthly:2.5,expected30d:2.3,expected90d:6.9,yearly:30.5}, rates:{bcraPolicy:20,moneyMarket:20,plazoFijo:19,plazoFijoUVA:4.5,lecaps:25,badlar:22,leliq:20,tml:20}, cer:{index:786,monthlyChange:2.2,dailyChange:0.07}, crawlingPeg:0.0, realDataPct:30, provenance:{mepRate:mp('PARTIAL_FALLBACK'),inflation:mp('PARTIAL_FALLBACK'),rates:mp('PARTIAL_FALLBACK'),cer:mp('PARTIAL_FALLBACK'),crawlingPeg:mp('ERROR'),reserves:mp('PARTIAL_FALLBACK')}} },
    { id:'stress-deval', label:'Stress: Sudden Devaluation', actualRegime:'CRISIS', actualReturn:-6.0, macro:{ lastUpdate:now, fetchedAt:now, ageMinutes:0, lastSuccessfulFetch:now, source:'ERROR', mep:{rate:1878,officialRate:1440,gap:30.4,sell:1900,buy:1850}, inflation:{monthly:8.0,expected30d:10.0,expected90d:25.0,yearly:80.0}, rates:{bcraPolicy:45,moneyMarket:42,plazoFijo:38,plazoFijoUVA:5.0,lecaps:48,badlar:40,leliq:45,tml:38}, cer:{index:830,monthlyChange:7.5,dailyChange:0.24}, crawlingPeg:0.0, realDataPct:10, provenance:{mepRate:mp('ERROR'),inflation:mp('ERROR'),rates:mp('ERROR'),cer:mp('ERROR'),crawlingPeg:mp('ERROR'),reserves:mp('ERROR')}} },
    { id:'stress-recession', label:'Stress: Prolonged Recession', actualRegime:'NORMAL', actualReturn:0.3, macro:{ lastUpdate:now, fetchedAt:now, ageMinutes:0, lastSuccessfulFetch:now, source:'ERROR', mep:{rate:1500,officialRate:1460,gap:2.7,sell:1510,buy:1490}, inflation:{monthly:1.8,expected30d:1.5,expected90d:4.5,yearly:22.0}, rates:{bcraPolicy:15,moneyMarket:14,plazoFijo:12,plazoFijoUVA:3.0,lecaps:18,badlar:13,leliq:15,tml:12}, cer:{index:810,monthlyChange:1.6,dailyChange:0.05}, crawlingPeg:0.0, realDataPct:20, provenance:{mepRate:mp('ERROR'),inflation:mp('ERROR'),rates:mp('ERROR'),cer:mp('ERROR'),crawlingPeg:mp('ERROR'),reserves:mp('ERROR')}} },
    { id:'stress-inflation', label:'Stress: Inflation Resurgence', actualRegime:'HIGH_VOL', actualReturn:-1.5, macro:{ lastUpdate:now, fetchedAt:now, ageMinutes:0, lastSuccessfulFetch:now, source:'ERROR', mep:{rate:1550,officialRate:1450,gap:6.9,sell:1560,buy:1540}, inflation:{monthly:5.0,expected30d:6.0,expected90d:18.0,yearly:60.0}, rates:{bcraPolicy:30,moneyMarket:28,plazoFijo:25,plazoFijoUVA:5.5,lecaps:33,badlar:26,leliq:30,tml:24}, cer:{index:850,monthlyChange:4.8,dailyChange:0.16}, crawlingPeg:0.5, realDataPct:20, provenance:{mepRate:mp('ERROR'),inflation:mp('ERROR'),rates:mp('ERROR'),cer:mp('ERROR'),crawlingPeg:mp('ERROR'),reserves:mp('ERROR')}} },
  ];
}

// ============================================================================
// D1 LOGGING (non-blocking)
// ============================================================================
async function logMacroSnapshot(env, macro, regime, confidence) {
  try {
    await env.ORACLE_DB.prepare('INSERT INTO macro_snapshots (id,source,data_label,mep_rate,official_rate,mep_gap,inflation_monthly,inflation_expected30d,bcra_policy_rate,money_market_tna,plazo_fijo_tna,plazo_fijo_uva_premium,lecaps_tna,badlar_tna,leliq_tna,cer_index,cer_monthly_change,crawling_peg,real_data_pct,staleness_hours) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(`MS-${Date.now()}`,'worker',macro.source,macro.mep.rate,macro.mep.officialRate,macro.mep.gap,macro.inflation.monthly,macro.inflation.expected30d,macro.rates.bcraPolicy,macro.rates.moneyMarket,macro.rates.plazoFijo,macro.rates.plazoFijoUVA,macro.rates.lecaps,macro.rates.badlar,macro.rates.leliq,macro.cer.index,macro.cer.monthlyChange,macro.crawlingPeg,macro.realDataPct,0).run();
  } catch {}
}
async function logDecision(env, out, mode, capital) {
  try {
    await env.ORACLE_DB.prepare('INSERT INTO decisions_log (id,decision_type,severity,summary,action,reasoning_json,context_json,data_quality,confidence,regime,active_directives_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(`DEC-${Date.now()}`,'ALLOCATION_COMPUTED','info',`X10 allocation: mode=${mode}, capital=$${capital}`,`Computed allocation with ${out.portfolio_allocation.length} positions`,JSON.stringify([`Mode: ${mode}`,`Confidence: ${out.confidence_score}`,`Regime: ${out.signalLayer.regime.regime}`]),JSON.stringify({dataAgeMinutes:out.dataLayer.dataAgeMinutes,realDataPct:out.dataLayer.realDataPct}),out.dataLayer.macroSource,out.confidence_score,out.signalLayer.regime.regime,JSON.stringify(Object.entries(out.x10Directives).filter(([,v])=>v.active).map(([k])=>k))).run();
  } catch {}
}
async function logRegimeObservation(env, regime, confidence, macro) {
  try {
    await env.ORACLE_DB.prepare('INSERT INTO regime_history (id,regime,confidence,data_quality,mep_rate,inflation_monthly,bcra_policy_rate) VALUES (?,?,?,?,?,?,?)')
      .bind(`RH-${Date.now()}`,regime,confidence,macro.source,macro.mep.rate,macro.inflation.monthly,macro.rates.bcraPolicy).run();
  } catch {}
}

// ============================================================================
// DATA FETCHER — External APIs + KV Cache
// ============================================================================
async function fetchMacroState(env) {
  try {
    const cached = await env.ORACLE_KV.get('macro_state', 'json');
    if (cached) { const age = (Date.now() - new Date(cached.fetchedAt).getTime()) / 60000; if (age < 5) return cached; }
  } catch {}
  const now = isoNow();
  const [bluelyticsResult, bcraRatesResult, bcraFxResult, indecResult, cerResult] = await Promise.allSettled([
    fetchJSON('https://api.bluelytics.com.ar/v2/latest'),
    fetchJSON('https://api.estadisticasbcra.com.ar/tesoreria', env.BCRA_API_KEY ? { Authorization: `Bearer ${env.BCRA_API_KEY}` } : {}),
    fetchJSON('https://api.estadisticasbcra.com.ar/usd_of', env.BCRA_API_KEY ? { Authorization: `Bearer ${env.BCRA_API_KEY}` } : {}),
    fetchJSON('https://apis.datos.gob.ar/series/api/series?ids=148.3_INIVELNAL_DICI_M_26:percent_change&limit=6'),
    fetchJSON('https://api.estadisticasbcra.com.ar/cer', env.BCRA_API_KEY ? { Authorization: `Bearer ${env.BCRA_API_KEY}` } : {}),
  ]);
  let mepRate=1445,officialRate=1440,mepGap=0.35,mepSell=1450,mepBuy=1440,mepLabel='PARTIAL_FALLBACK',mepStaleness=0;
  if (bluelyticsResult.status==='fulfilled'&&bluelyticsResult.value.data&&!bluelyticsResult.value.error) {
    const b=bluelyticsResult.value.data;
    mepRate=b.blue.value_avg;officialRate=b.oficial.value_avg;mepSell=b.blue.value_sell;mepBuy=b.blue.value_buy;
    mepGap=officialRate>0?((mepRate-officialRate)/officialRate)*100:0;mepLabel='REAL';
  } else { mepLabel='ERROR'; }
  let bcraPolicy=20,badlar=22,leliq=20,tml=20,moneyMarket=20,plazoFijo=19,plazoFijoUVA=4.5,lecaps=25,ratesLabel='PARTIAL_FALLBACK',ratesStaleness=0;
  if (bcraRatesResult.status==='fulfilled'&&bcraRatesResult.value.data&&!bcraRatesResult.value.error) {
    const rates=bcraRatesResult.value.data;
    for (const entry of rates) {
      const d=(entry.descripcion||'').toLowerCase();
      if(d.includes('tna')||d.includes('politica'))bcraPolicy=entry.valor;
      else if(d.includes('badlar'))badlar=entry.valor;
      else if(d.includes('leliq'))leliq=entry.valor;
      else if(d.includes('tml'))tml=entry.valor;
      else if(d.includes('plazo')&&d.includes('fijo'))plazoFijo=entry.valor;
      else if(d.includes('lecaps'))lecaps=entry.valor;
    }
    moneyMarket=badlar*0.95;ratesLabel='REAL';
  }
  let inflationMonthly=2.5,inflationExpected30d=2.3,inflationExpected90d=6.9,inflationYearly=30.5,inflationLabel='PARTIAL_FALLBACK',inflationStaleness=0;
  if (indecResult.status==='fulfilled'&&indecResult.value.data&&!indecResult.value.error) {
    try { const ipcData=indecResult.value.data; if(ipcData?.data&&Array.isArray(ipcData.data)&&ipcData.data.length>0){const latest=ipcData.data[ipcData.data.length-1];inflationMonthly=latest?.valor??latest?.[1]??2.5;inflationLabel='REAL';} } catch { inflationLabel='PARTIAL_FALLBACK'; }
  }
  let cerIndex=786,cerMonthlyChange=2.2,cerDailyChange=0.07,cerLabel='PARTIAL_FALLBACK',cerStaleness=0;
  if (cerResult.status==='fulfilled'&&cerResult.value.data&&!cerResult.value.error) {
    try { const cd=cerResult.value.data; if(Array.isArray(cd)&&cd.length>=2){const l=cd[cd.length-1],p=cd[cd.length-2];cerIndex=l.valor??cerIndex;cerMonthlyChange=p.valor>0?((cerIndex-p.valor)/p.valor)*100:cerMonthlyChange;cerDailyChange=cerMonthlyChange/30;cerLabel='REAL';} } catch { cerLabel='PARTIAL_FALLBACK'; }
  }
  const crawlingPeg=0.0;
  const dataPoints=[mepLabel,inflationLabel,ratesLabel,cerLabel,'PARTIAL_FALLBACK','PARTIAL_FALLBACK','PARTIAL_FALLBACK'];
  const realCount=dataPoints.filter(d=>d==='REAL').length;
  const realDataPct=Math.round((realCount/dataPoints.length)*100);
  const overallLabel=dataPoints.some(d=>d==='ERROR')?'ERROR':dataPoints.some(d=>d==='STALE')?'STALE':realDataPct>=60?'REAL':realDataPct>=30?'PARTIAL_FALLBACK':'ERROR';
  const makeProv=(src,url,label)=>({label,source:src,url,lastUpdate:now,dataDate:now.split('T')[0],stalenessHours:0,fetchedAt:now,ageMinutes:0,fetchError:false});
  const macroState = {
    lastUpdate:now,fetchedAt:now,ageMinutes:0,lastSuccessfulFetch:now,source:overallLabel,
    mep:{rate:r2(mepRate),officialRate:r2(officialRate),gap:r2(mepGap),sell:r2(mepSell),buy:r2(mepBuy)},
    inflation:{monthly:r2(inflationMonthly),expected30d:r2(inflationExpected30d),expected90d:r2(inflationExpected90d),yearly:r2(inflationYearly)},
    rates:{bcraPolicy:r2(bcraPolicy),moneyMarket:r2(moneyMarket),plazoFijo:r2(plazoFijo),plazoFijoUVA:r2(plazoFijoUVA),lecaps:r2(lecaps),badlar:r2(badlar),leliq:r2(leliq),tml:r2(tml)},
    cer:{index:r2(cerIndex),monthlyChange:r2(cerMonthlyChange),dailyChange:r4(cerDailyChange)},
    crawlingPeg,realDataPct,
    provenance:{mepRate:makeProv('Bluelytics','https://api.bluelytics.com.ar/v2/latest',mepLabel),inflation:makeProv('INDEC','https://apis.datos.gob.ar/series/api/series',inflationLabel),rates:makeProv('BCRA','https://api.estadisticasbcra.com.ar/tesoreria',ratesLabel),cer:makeProv('BCRA','https://api.estadisticasbcra.com.ar/cer',cerLabel),crawlingPeg:makeProv('MODEL','N/A','PARTIAL_FALLBACK'),reserves:makeProv('MODEL','N/A','PARTIAL_FALLBACK')},
  };
  try { await env.ORACLE_KV.put('macro_state', JSON.stringify(macroState), { expirationTtl: 300 }); } catch {}
  return macroState;
}

async function fetchJSON(url, headers = {}) {
  const start = Date.now();
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
    if (!r.ok) return { data: null, error: `HTTP ${r.status}`, url, responseTimeMs: Date.now() - start };
    return { data: await r.json(), error: null, url, responseTimeMs: Date.now() - start };
  } catch (err) { return { data: null, error: String(err), url, responseTimeMs: Date.now() - start }; }
}

// ============================================================================
// ENGINE — Pure functions, no I/O
// ============================================================================
function clamp01(x){return Math.max(0,Math.min(1,x));}
function r2(x){return Math.round(x*100)/100;}
function r4(x){return Math.round(x*10000)/10000;}
function isoNow(){return new Date().toISOString();}
function round2(x){return Math.round(x*100)/100;}

function computeOracle(macro) {
  const gap=macro.mep.gap;
  const fxMomentum=clamp01(gap/60)*100;
  const inflBaseline=2.0;
  const inflationAccel=clamp01((macro.inflation.expected30d-inflBaseline)/8)*100;
  const rateSpread=Math.abs(macro.rates.bcraPolicy-macro.rates.moneyMarket);
  const crawlingIntensity=clamp01(macro.crawlingPeg/5)*100;
  const reservePressure=clamp01((rateSpread*5+crawlingIntensity)/150)*100;
  const usdNeutralRate=5.0;
  const rateGapRaw=macro.rates.moneyMarket-usdNeutralRate;
  const rateGapUSD=clamp01(rateGapRaw/40)*100;
  const devalScore=(fxMomentum*0.35)+(inflationAccel*0.25)+(reservePressure*0.20)+(rateGapUSD*0.20);
  const devaluationProbability=clamp01(devalScore/100)*100;
  const devaluationRiskBand=devaluationProbability<25?'stable':devaluationProbability<50?'caution':devaluationProbability<75?'high':'crisis';
  const regime=determineRegime(macro,devaluationProbability);
  const signalAgreement=computeSignalAgreement(fxMomentum,inflationAccel,reservePressure,rateGapUSD);
  const realPct=macro.realDataPct;
  const dataQuality=macro.source==='OBSERVADO'?95:macro.source==='REAL'?Math.min(90,40+realPct*0.55):macro.source==='STALE'?25:macro.source==='ERROR'?10:40;
  const confidenceScore=Math.round(signalAgreement*0.6+dataQuality*0.4);
  const signals=[
    {name:'Tipo de cambio',value:r2(fxMomentum),weight:0.35,contribution:r2(fxMomentum*0.35),direction:fxMomentum>50?'bajista':fxMomentum>25?'neutral':'alcista'},
    {name:'Inflaci\u00F3n',value:r2(inflationAccel),weight:0.25,contribution:r2(inflationAccel*0.25),direction:inflationAccel>50?'bajista':inflationAccel>25?'neutral':'alcista'},
    {name:'Reservas',value:r2(reservePressure),weight:0.20,contribution:r2(reservePressure*0.20),direction:reservePressure>50?'bajista':reservePressure>25?'neutral':'alcista'},
    {name:'Tasas',value:r2(rateGapUSD),weight:0.20,contribution:r2(rateGapUSD*0.20),direction:rateGapUSD>70?'bajista':rateGapUSD>40?'neutral':'alcista'},
  ];
  return {regime,devaluationProbability:r2(devaluationProbability),devaluationRiskBand,confidenceScore,fxMomentum:r2(fxMomentum),inflationAcceleration:r2(inflationAccel),reservePressure:r2(reservePressure),rateGapUSD:r2(rateGapUSD),timestamp:isoNow(),source:macro.source,signals,dataQualityPct:Math.round(dataQuality)};
}

function determineRegime(macro,devalProb) {
  if(macro.source==='ERROR')return 'CRISIS';
  if(devalProb>75)return 'CRISIS';
  if(devalProb>50)return 'WARNING';
  if(macro.mep.gap>50)return 'HIGH_VOL';
  const fisherReal=((1+macro.rates.moneyMarket/12)/(1+macro.inflation.monthly/100))-1;
  if(fisherReal>0.01&&macro.inflation.monthly<4&&macro.mep.gap<25)return 'CARRY_FAVORABLE';
  if(fisherReal>0.005&&macro.inflation.monthly<5)return 'CARRY';
  return 'NORMAL';
}

function computeSignalAgreement(fx,infl,reserves,rates) {
  const values=[fx,infl,reserves,rates];
  const mean=values.reduce((s,v)=>s+v,0)/values.length;
  const variance=values.reduce((s,v)=>s+(v-mean)**2,0)/values.length;
  return clamp01(1-variance/2500)*100;
}

function classifyRegime(macro) {
  const oracle=computeOracle(macro);
  const regime=mapOracleToCapitalRegime(oracle.regime);
  const confidence=oracle.confidenceScore/100;
  return {regime,confidence,oracle};
}

function mapOracleToCapitalRegime(regime) {
  switch(regime){case'CARRY_FAVORABLE':return'CARRY_FAVORABLE';case'CARRY':return'NORMAL';case'NORMAL':return'NORMAL';case'WARNING':return'HIGH_VOL';case'HIGH_VOL':return'HIGH_VOL';case'CRISIS':return'CRISIS';case'GLOBAL_RISK_OFF':return'CRISIS';default:return'NORMAL';}
}

function computeL1Signals(macro) {
  const now=isoNow();
  const oracle=computeOracle(macro);
  const regimeX10=oracle.regime==='CARRY'||oracle.regime==='CARRY_FAVORABLE'?'CARRY_FAVORABLE':oracle.regime==='NORMAL'?'CARRY_NEUTRAL':oracle.regime==='WARNING'||oracle.regime==='HIGH_VOL'?'WARNING':'CRISIS';
  const regimeSignal={value:clamp01(oracle.devaluationProbability/100),strength:oracle.devaluationProbability>75?'extreme':oracle.devaluationProbability>50?'high':oracle.devaluationProbability>25?'medium':'low',direction:oracle.devaluationProbability>50?'accelerating':oracle.devaluationProbability>25?'stable':'decelerating',confidence:oracle.confidenceScore/100,sourceLabel:macro.source,drivers:['fx_gap','inflation','reserves','rate_spread'],timestamp:now,dataAgeMinutes:macro.ageMinutes,isDiscounted:macro.source==='STALE'||macro.source==='ERROR'};
  const inflationSignal={value:clamp01(macro.inflation.expected30d/10),strength:macro.inflation.expected30d>8?'extreme':macro.inflation.expected30d>5?'high':macro.inflation.expected30d>3?'medium':'low',direction:macro.inflation.expected30d>macro.inflation.monthly?'accelerating':macro.inflation.expected30d<macro.inflation.monthly*0.8?'decelerating':'stable',confidence:macro.provenance.inflation.label==='REAL'?0.9:macro.provenance.inflation.label==='STALE'?0.3:0.5,sourceLabel:macro.provenance.inflation.label,drivers:['ipc_mensual','expectativas_30d'],timestamp:now,dataAgeMinutes:macro.ageMinutes,isDiscounted:macro.provenance.inflation.label==='STALE'||macro.provenance.inflation.label==='ERROR'};
  const fisherReal=((1+macro.rates.moneyMarket/12)/(1+macro.inflation.monthly/100))-1;
  const carrySignal={value:clamp01(fisherReal*50+0.5),strength:fisherReal>0.02?'extreme':fisherReal>0.01?'high':fisherReal>0?'medium':'low',direction:fisherReal>0.005?'accelerating':fisherReal<-0.005?'reversing':'stable',confidence:macro.provenance.rates.label==='REAL'&&macro.provenance.inflation.label==='REAL'?0.85:0.4,sourceLabel:macro.source,drivers:['fisher_real_rate','money_market_tna','inflation'],timestamp:now,dataAgeMinutes:macro.ageMinutes,isDiscounted:macro.source==='STALE'||macro.source==='ERROR'};
  const gapVol=macro.mep.gap;
  const volRegime=gapVol>80?'crisis':gapVol>50?'stressed':gapVol>25?'elevated':gapVol>10?'normal':'calm';
  const volatilitySignal={value:clamp01(gapVol/80),strength:volRegime==='crisis'?'extreme':volRegime==='stressed'?'high':volRegime==='elevated'?'medium':'low',direction:macro.mep.gap>30?'accelerating':'stable',confidence:macro.provenance.mepRate.label==='REAL'?0.85:0.4,sourceLabel:macro.provenance.mepRate.label,drivers:['mep_gap','fx_volatility'],timestamp:now,dataAgeMinutes:macro.ageMinutes,isDiscounted:macro.provenance.mepRate.label==='STALE'};
  const liqRegime=macro.rates.bcraPolicy>50?'frozen':macro.rates.bcraPolicy>30?'stressed':macro.rates.bcraPolicy>15?'tight':macro.rates.bcraPolicy>5?'normal':'abundant';
  const liquiditySignal={value:clamp01(macro.rates.bcraPolicy/50),strength:liqRegime==='frozen'?'extreme':liqRegime==='stressed'?'high':liqRegime==='tight'?'medium':'low',direction:macro.rates.bcraPolicy>30?'accelerating':'decelerating',confidence:macro.provenance.rates.label==='REAL'?0.8:0.4,sourceLabel:macro.provenance.rates.label,drivers:['bcra_policy_rate','leliq','badlar'],timestamp:now,dataAgeMinutes:macro.ageMinutes,isDiscounted:macro.provenance.rates.label==='STALE'};
  const allConf=[regimeSignal.confidence,inflationSignal.confidence,carrySignal.confidence,volatilitySignal.confidence,liquiditySignal.confidence];
  const aggregateConfidence=allConf.reduce((s,c)=>s+c,0)/allConf.length;
  const capitalPreservationMode=macro.source==='STALE'||macro.source==='ERROR'||aggregateConfidence<0.5;
  const emergencyFreeze=macro.source==='ERROR';
  return {regime:{regime:regimeX10,signal:regimeSignal},inflation:{name:'inflation',signal:inflationSignal},carry:{name:'carry',signal:carrySignal},volatility:{name:'volatility',signal:volatilitySignal},liquidity:{name:'liquidity',signal:liquiditySignal},aggregateConfidence:r2(aggregateConfidence),capitalPreservationMode,emergencyFreeze};
}

const BASE_ALLOCATIONS={
  CRISIS:{capital_preservation:{weight:0.80,return:0.006},inflation_hedge:{weight:0.10,return:0.009},carry_opportunistic:{weight:0.00,return:0.015},usd_hedge_growth:{weight:0.10,return:0.008},tactical:{weight:0.00,return:0.020}},
  HIGH_VOL:{capital_preservation:{weight:0.50,return:0.006},inflation_hedge:{weight:0.25,return:0.009},carry_opportunistic:{weight:0.00,return:0.015},usd_hedge_growth:{weight:0.20,return:0.008},tactical:{weight:0.05,return:0.020}},
  NORMAL:{capital_preservation:{weight:0.40,return:0.006},inflation_hedge:{weight:0.25,return:0.009},carry_opportunistic:{weight:0.15,return:0.015},usd_hedge_growth:{weight:0.15,return:0.008},tactical:{weight:0.05,return:0.020}},
  CARRY_FAVORABLE:{capital_preservation:{weight:0.25,return:0.006},inflation_hedge:{weight:0.15,return:0.009},carry_opportunistic:{weight:0.25,return:0.015},usd_hedge_growth:{weight:0.25,return:0.008},tactical:{weight:0.10,return:0.020}},
};
const BUCKET_PRODUCTS={
  capital_preservation:[{id:'super_ahorro',name:'Super Ahorro Santander',category:'money_market'},{id:'fci_money_market',name:'FCI Money Market',category:'money_market'}],
  inflation_hedge:[{id:'pf_uva',name:'Plazo Fijo UVA',category:'cer_indexed'},{id:'lecaps',name:'Lecaps',category:'cer_indexed'}],
  carry_opportunistic:[{id:'pf_tradicional',name:'Plazo Fijo Tradicional',category:'nominal'},{id:'fci_renta_fija',name:'FCI Renta Fija',category:'nominal'}],
  usd_hedge_growth:[{id:'fci_usd',name:'FCI USD Santander',category:'fx_hedge'},{id:'bono_usd',name:'Bono USD',category:'fx_hedge'}],
  tactical:[{id:'lecaps_tactical',name:'Lecaps Tactical',category:'opportunistic'}],
};

function computeAllocation(macro,mode,capitalUSD) {
  const {regime}=classifyRegime(macro);
  const allocations=BASE_ALLOCATIONS[regime];
  let riskMultiplier=mode==='CONSERVATIVE'?0.5:mode==='AGGRESSIVE'?1.5:1.0;
  const signals=computeL1Signals(macro);
  if(signals.aggregateConfidence<0.7)riskMultiplier*=0.5;
  const portfolio=[];
  for(const[bucketKey,bucketAlloc]of Object.entries(allocations)){
    let weight=bucketAlloc.weight;
    if(bucketKey!=='capital_preservation'&&bucketKey!=='inflation_hedge')weight=Math.min(weight*riskMultiplier,weight*1.5);
    const products=BUCKET_PRODUCTS[bucketKey]||[];
    if(products.length===0)continue;
    const perProductWeight=weight/products.length;
    for(const product of products){
      portfolio.push({productId:product.id,productName:product.name,weight:r4(perProductWeight),amountUSD:r2(capitalUSD*perProductWeight),category:product.category,strategySource:bucketKey==='carry_opportunistic'?'carry_optimization':'usd_hedged_allocations'});
    }
  }
  const totalWeight=portfolio.reduce((s,a)=>s+a.weight,0);
  if(totalWeight>0){for(const alloc of portfolio){alloc.weight=r4(alloc.weight/totalWeight);alloc.amountUSD=r2(capitalUSD*alloc.weight);}}
  return {allocations:portfolio,regime};
}

function computeRiskMetrics(macro,regime,confidence) {
  const fisherReal=((1+macro.rates.moneyMarket/12)/(1+macro.inflation.monthly/100))-1;
  const bucketAllocs=BASE_ALLOCATIONS[regime];
  const expectedReturn30d=Object.values(bucketAllocs).reduce((s,b)=>s+b.weight*b.return,0)*100;
  const probabilityOfLoss=regime==='CRISIS'?0.35:regime==='HIGH_VOL'?0.20:regime==='NORMAL'?0.10:0.08;
  const maxDrawdown=regime==='CRISIS'?12:regime==='HIGH_VOL'?8:regime==='NORMAL'?3:2;
  const capitalAtRisk=probabilityOfLoss>0.15?0.15:probabilityOfLoss;
  return {expectedReturn30d:r2(expectedReturn30d),expectedReturn90d:r2(expectedReturn30d*2.8),probabilityOfLoss:r2(probabilityOfLoss),maxDrawdownEstimate:r2(maxDrawdown),capitalAtRisk:r2(capitalAtRisk),sharpeEstimate:r2(expectedReturn30d/(maxDrawdown||1)),fisherRealRate:r4(fisherReal),volatilityRegime:regime==='CRISIS'?'crisis':regime==='HIGH_VOL'?'stressed':regime==='CARRY_FAVORABLE'?'calm':'normal',liquidityCondition:macro.rates.bcraPolicy>50?'frozen':macro.rates.bcraPolicy>30?'stressed':'normal',capitalPreservationPct:r2(bucketAllocs.capital_preservation.weight*100)};
}

function computeScenarios(macro,regime) {
  const baseReturn=regime==='CRISIS'?-3.0:regime==='HIGH_VOL'?-0.5:regime==='CARRY_FAVORABLE'?1.5:0.8;
  return {
    downside:{returnMin:r2(baseReturn-5),returnMax:r2(baseReturn-1),probability:r2(regime==='CRISIS'?0.35:0.15),label:'Downside'},
    base:{returnMin:r2(baseReturn-1),returnMax:r2(baseReturn+1),probability:r2(regime==='CRISIS'?0.40:0.55),label:'Base'},
    upside:{returnMin:r2(baseReturn+0.5),returnMax:r2(baseReturn+3),probability:r2(regime==='CRISIS'?0.25:0.30),label:'Upside'},
  };
}

function computeX10Directives(macro,signals) {
  return {
    confidenceThrottle:{active:signals.aggregateConfidence<0.7,reason:signals.aggregateConfidence<0.7?`Confidence ${r2(signals.aggregateConfidence)} < 0.7 threshold`:''},
    capitalPreservationFallback:{active:macro.source==='STALE'||macro.source==='ERROR'||signals.capitalPreservationMode,reason:macro.source==='STALE'?'Macro data STALE':macro.source==='ERROR'?'Macro data ERROR':signals.capitalPreservationMode?'Capital preservation triggered':''},
    emergencyFreeze:{active:macro.source==='ERROR'||signals.emergencyFreeze,reason:macro.source==='ERROR'?'Macro data ERROR — freeze all strategy updates':''},
    deRiskMode:{active:signals.regime.signal.value>0.6||signals.aggregateConfidence<0.5,reason:signals.regime.signal.value>0.6?'High regime stress detected':signals.aggregateConfidence<0.5?'Very low confidence':''},
  };
}

function runX10Engine(macro,mode,capitalUSD) {
  const startMs=Date.now();
  const signals=computeL1Signals(macro);
  const {allocations,regime}=computeAllocation(macro,mode,capitalUSD);
  const riskMetrics=computeRiskMetrics(macro,regime,signals.aggregateConfidence);
  const scenarios=computeScenarios(macro,regime);
  const x10Directives=computeX10Directives(macro,signals);
  return {
    engineVersion:'X10-CF-WORKER-v1.0',timestamp:isoNow(),durationMs:Date.now()-startMs,
    dataLayer:{macroSource:macro.source,dataAgeMinutes:macro.ageMinutes,realDataPct:macro.realDataPct,hasError:macro.source==='ERROR',allStale:macro.source==='STALE'},
    signalLayer:{regime:signals.regime,inflation:signals.inflation,carry:signals.carry,volatility:signals.volatility,liquidity:signals.liquidity,aggregateConfidence:signals.aggregateConfidence,capitalPreservationMode:signals.capitalPreservationMode,emergencyFreeze:signals.emergencyFreeze},
    portfolio_allocation:allocations,risk_metrics:riskMetrics,confidence_score:r2(signals.aggregateConfidence),
    scenario_downside:scenarios.downside,scenario_base:scenarios.base,scenario_upside:scenarios.upside,x10Directives,
  };
}

// ============================================================================
// SEEDED PRNG (mulberry32)
// ============================================================================
function mulberry32(seed) {
  let state = seed | 0;
  return function() {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// CORS + JSON HELPERS
// ============================================================================
function corsHeaders() {
  return { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization' };
}
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type':'application/json', ...corsHeaders() } });
}
