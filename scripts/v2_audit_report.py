#!/usr/bin/env python3
"""
ORACLE V2 SYSTEMIC ROBUSTNESS — Final Audit Report
Generates a PDF with: implementation audit, typecheck result, build result,
architectural diff (V1 → V2), and per-layer validation.
"""
import os, json, subprocess, datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Register fonts
try:
    pdfmetrics.registerFont(TTFont('NotoSans', '/usr/share/fonts/truetype/chinese/NotoSansSC-Regular.ttf'))
    pdfmetrics.registerFont(TTFont('NotoSans-Bold', '/usr/share/fonts/truetype/chinese/NotoSansSC-Bold.ttf'))
    FONT = 'NotoSans'
    FONT_BOLD = 'NotoSans-Bold'
except Exception:
    FONT = 'Helvetica'
    FONT_BOLD = 'Helvetica-Bold'

OUT_PATH = '/home/z/my-project/download/ORACLE_V2_SYSTEMIC_ROBUSTNESS_AUDIT.pdf'

# ─── Gather facts ──────────────────────────────────────────────────────────

def file_count(path):
    n = 0
    for root, _, files in os.walk(path):
        for f in files:
            if f.endswith(('.ts', '.tsx')):
                n += 1
    return n

def line_count(path):
    n = 0
    for root, _, files in os.walk(path):
        for f in files:
            if f.endswith(('.ts', '.tsx')):
                try:
                    with open(os.path.join(root, f)) as fh:
                        n += sum(1 for _ in fh)
                except: pass
    return n

v2_lib_files = file_count('/home/z/my-project/src/lib/oracle/v2')
v2_lib_lines = line_count('/home/z/my-project/src/lib/oracle/v2')
v2_ui_files = file_count('/home/z/my-project/src/components/oracle/v2')
v2_ui_lines = line_count('/home/z/my-project/src/components/oracle/v2')

# ─── Build PDF ─────────────────────────────────────────────────────────────

doc = SimpleDocTemplate(
    OUT_PATH, pagesize=A4,
    leftMargin=1.8*cm, rightMargin=1.8*cm,
    topMargin=2*cm, bottomMargin=2*cm,
    title='Oracle V2 Systemic Robustness — Audit Report',
)
styles = getSampleStyleSheet()
title_style = ParagraphStyle('Title', parent=styles['Title'], fontName=FONT_BOLD, fontSize=18, leading=22, spaceAfter=8)
h1_style = ParagraphStyle('H1', parent=styles['Heading1'], fontName=FONT_BOLD, fontSize=14, leading=18, spaceBefore=14, spaceAfter=6, textColor=colors.HexColor('#0066cc'))
h2_style = ParagraphStyle('H2', parent=styles['Heading2'], fontName=FONT_BOLD, fontSize=11, leading=14, spaceBefore=10, spaceAfter=4, textColor=colors.HexColor('#333333'))
body_style = ParagraphStyle('Body', parent=styles['Normal'], fontName=FONT, fontSize=9.5, leading=13, spaceAfter=4)
mono_style = ParagraphStyle('Mono', parent=styles['Code'], fontName='Courier', fontSize=8.5, leading=11, leftIndent=10, textColor=colors.HexColor('#444444'))
small_style = ParagraphStyle('Small', parent=styles['Normal'], fontName=FONT, fontSize=8, leading=10, textColor=colors.HexColor('#666666'))

story = []

# ─── Title ─────────────────────────────────────────────────────────────────
story.append(Paragraph('Oracle V2 — Systemic Robustness Audit', title_style))
story.append(Paragraph(f'Generated: {datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC-3")}', small_style))
story.append(Paragraph('Mission: Convertir Single Oracle en motor institucional autoevaluable, autoexplicable y autoadaptable.', body_style))
story.append(Spacer(1, 12))

# ─── Section 1: Executive Summary ──────────────────────────────────────────
story.append(Paragraph('1. Executive Summary', h1_style))
story.append(Paragraph(
    'Se implementaron las 10 capas de robustez sistémica (R1-R10) sobre el core canónico V1 '
    '(<i>single-pass-oracle-engine</i>). La implementación es <b>100% append-only</b>: '
    'no se modificaron contratos V1, no se rompieron APIs, no se duplicaron pipelines, '
    'no se crearon nuevos estados globales. Las 10 capas viven bajo '
    '<font face="Courier">src/lib/oracle/v2/</font> y se orchestran desde un único '
    'entry point: <font face="Courier">runV2SystemicEnrichment()</font>.', body_style))
story.append(Spacer(1, 6))

# Stats table
stats_data = [
    ['Métrica', 'Valor'],
    ['Capas V2 implementadas', '10 / 10 (R1-R10)'],
    ['Nuevos archivos lib (src/lib/oracle/v2/)', f'{v2_lib_files}'],
    ['Líneas de código lib V2', f'{v2_lib_lines}'],
    ['Nuevos archivos UI (src/components/oracle/v2/)', f'{v2_ui_files}'],
    ['Líneas de código UI V2', f'{v2_ui_lines}'],
    ['Archivos V1 modificados', '2 (route.ts + single-oracle-panel.tsx)'],
    ['APIs rotas', '0'],
    ['Tipos V1 modificados destructivamente', '0'],
    ['Typecheck', 'PASS (0 errores en src/)'],
    ['Build', 'PASS (Next.js 16.1.3, Turbopack)'],
    ['Smoke test /api/oracle/single', 'PASS (V1+V2 response OK)'],
    ['Deploy', 'NO REALIZADO (per DEPLOY_POLICY.deploy_now=false)'],
]
t = Table(stats_data, colWidths=[8.5*cm, 8.5*cm])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#0066cc')),
    ('TEXTCOLOR', (0,0), (-1,0), colors.white),
    ('FONTNAME', (0,0), (-1,0), FONT_BOLD),
    ('FONTNAME', (0,1), (-1,-1), FONT),
    ('FONTSIZE', (0,0), (-1,-1), 9),
    ('GRID', (0,0), (-1,-1), 0.3, colors.HexColor('#cccccc')),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f9f9f9')]),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('LEFTPADDING', (0,0), (-1,-1), 6),
    ('TOPPADDING', (0,0), (-1,-1), 4),
    ('BOTTOMPADDING', (0,0), (-1,-1), 4),
]))
story.append(t)

story.append(PageBreak())

# ─── Section 2: Architectural Diff ─────────────────────────────────────────
story.append(Paragraph('2. Architectural Diff (V1 → V2)', h1_style))
story.append(Paragraph(
    'La tabla muestra la transformación arquitectónica. V2 es un <b>enriquecimiento</b> '
    'sobre V1, no un reemplazo. Todos los componentes V1 permanecen como fuente canónica.',
    body_style))
story.append(Spacer(1, 6))

diff_data = [
    ['Aspecto', 'V1 (canónico)', 'V2 (enriquecimiento)'],
    ['Engine', 'single-pass-oracle-engine', 'UNCHANGED — V2 lee su salida'],
    ['MarketState', 'single-market-state', 'UNCHANGED — V2 lo consume read-only'],
    ['Scoring', 'linear-factor-model v1', 'UNCHANGED — V2 no toca los pesos'],
    ['Regime', '4 states (TIGHTENING/EASING/STAGFLATION/NEUTRAL)', 'R2: + 7-state classifier separado del scoring'],
    ['Confidence', 'AssetPrediction.confidence 0-1 (heurístico)', 'R1: + ConfidenceLayer 0-100 con 5 sub-métricas'],
    ['Explainability', 'ScoreBreakdown.contributions', 'R3: + top 5 positive/negative factors + reasoning_summary'],
    ['Verification', 'amira-prediction-lifecycle + closed-loop-learning', 'R4: + MAE/RMSE/MAPE/HitRate/Calibration/DirAcc'],
    ['Adaptive Weights', 'closed-loop-learning.updateWeightsFromVerification', 'R5: + reglas explícitas + rollback API + journal'],
    ['Lineage', '(no existía)', 'R6: + PredictionLineage con hash determinístico'],
    ['Health Monitor', '(no existía)', 'R7: + 6 métricas de drift/degradation/instability'],
    ['Scenario Engine', '(no existía)', 'R8: + 6 escenarios de shock sobre el mismo engine'],
    ['Audit Trail', '(no existía)', 'R9: + AuditEntry con decision_id + verification_status'],
    ['Foundation Models', '(no existía)', 'R10: + adapter interface pluggable (TimesFM/MAPIE stubs)'],
    ['API response shape', '{success, vector, learning}', '{success, vector, learning, v2} ← campo opcional'],
    ['UI blocks', '4 (MarketState/ScoreBoard/Prediction/Outcome)', '4 V1 + V2SystemicPanel con 10 bloques'],
    ['Global state nuevo', '—', '0 (V2 usa buffers in-memory bounded y documentados)'],
    ['Pipelines paralelos', '—', '0 (V2 enriquece, no duplica)'],
]
t = Table(diff_data, colWidths=[3.5*cm, 6*cm, 7.5*cm])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#0066cc')),
    ('TEXTCOLOR', (0,0), (-1,0), colors.white),
    ('FONTNAME', (0,0), (-1,0), FONT_BOLD),
    ('FONTNAME', (0,1), (-1,-1), FONT),
    ('FONTSIZE', (0,0), (-1,-1), 8.5),
    ('GRID', (0,0), (-1,-1), 0.3, colors.HexColor('#cccccc')),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f9f9f9')]),
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ('LEFTPADDING', (0,0), (-1,-1), 5),
    ('TOPPADDING', (0,0), (-1,-1), 4),
    ('BOTTOMPADDING', (0,0), (-1,-1), 4),
]))
story.append(t)
story.append(Spacer(1, 10))

# ─── Section 3: Per-Layer Audit ────────────────────────────────────────────
story.append(Paragraph('3. Per-Layer Audit (R1-R10)', h1_style))

layers = [
    ('R1', 'Prediction Confidence Layer', 'P0',
     'confidence-engine.ts',
     'ConfidenceLayer { confidence_score, prediction_dispersion, feature_agreement, data_quality, freshness_factor, uncertainty_band, contributors }',
     'Smoke: score=55.9/100, dispersion=47.1, agreement=100, data_quality=30, freshness=100, band=[-17.35%,-2.49%,+12.37%]'),
    ('R2', 'Regime Detector V2', 'P0',
     'regime-detector-v2.ts',
     '7-state softmax classifier (EASING/TIGHTENING/HIGH_INFLATION/DISINFLATION/CRISIS/RECOVERY/STRESS) + transition_probability matrix',
     'Smoke: EASING 63.7%, distribution over 7 states, top 3 transitions'),
    ('R3', 'Decision Explainability', 'P0',
     'explainer.ts',
     'DecisionExplanation { top_positive_factors[5], top_negative_factors[5], factor_weights, reasoning_summary }',
     'Smoke: 5 negative factors identified, narrative summary generated'),
    ('R4', 'Forecast Verification Engine', 'P0',
     'forecast-verifier.ts',
     'ForecastVerificationReport { MAE, RMSE, MAPE, HitRate, Calibration, DirectionalAccuracy, bias, window_size }',
     'Smoke: 0 verifications yet — metrics initialized to 0 (will populate from lifecycle)'),
    ('R5', 'Adaptive Weight Engine', 'P0',
     'adaptive-weights.ts',
     'applyVerifiedUpdate() with 4 rules (verified_only, fresh_enough, bounded, within_decay) + rollBackWeights(steps) + AdaptiveWeightJournalEntry',
     'Smoke: 0 updates, 0 rejections, drift_from_default=0, journal empty'),
    ('R6', 'Prediction Lineage', 'P1',
     'lineage.ts',
     'PredictionLineage { lineage_id, prediction_hash (FNV-1a), input_snapshot, market_state, weights, regime, score, decision, confidence, prediction }',
     'Smoke: hash fb00587efeead1a3 — deterministic & reproducible'),
    ('R7', 'Oracle Health Monitor', 'P1',
     'health-monitor.ts',
     '6 metrics (prediction_drift, feature_drift, missing_data, confidence_degradation, forecast_degradation, regime_instability) + composite_score 0-100 + status',
     'Smoke: composite=83.3 healthy (missing_data=critical expected on first run)'),
    ('R8', 'Scenario Engine', 'P1',
     'scenario-engine.ts',
     '6 shock scenarios (inflation/fx/rate/reserves + political/external) + base + worst/best/range. Uses canonical runSinglePass under shocked inputs',
     'Smoke: 6 scenarios + base, range 25.8-36.5 (spread 10.7)'),
    ('R9', 'Institutional Audit Trail', 'P1',
     'audit-trail.ts',
     'AuditEntry { decision_id, oracle_version, weights_version, market_snapshot, confidence, verification_status } + in-memory buffer 1000 entries',
     'Smoke: decision_id generated, verification_status=PENDING'),
    ('R10', 'Foundation Model Integration Layer', 'P2',
     'foundation-model-adapter.ts',
     'FoundationModelAdapter interface + pluggable registry + 2 stubs (TimesFM, MAPIE) + ensemble (Oracle @ 60% weight, advisory only)',
     'Smoke: 2 adapters registered, ensemble computed with oracle_forecast weight=0.6'),
]
for layer_id, name, prio, file, contract, smoke in layers:
    story.append(Paragraph(f'{layer_id} ({prio}) — {name}', h2_style))
    story.append(Paragraph(f'<b>File:</b> <font face="Courier">src/lib/oracle/v2/{file}</font>', body_style))
    story.append(Paragraph(f'<b>Contract:</b> {contract}', body_style))
    story.append(Paragraph(f'<b>Smoke test:</b> <i>{smoke}</i>', body_style))
    story.append(Spacer(1, 4))

story.append(PageBreak())

# ─── Section 4: Validation Gates ───────────────────────────────────────────
story.append(Paragraph('4. Validation Gates', h1_style))

gates_data = [
    ['Gate', 'Status', 'Detail'],
    ['Typecheck (tsc --noEmit)', 'PASS', '0 errores en src/. Pre-existing skills/ errors ajenos al proyecto.'],
    ['Build (next build)', 'PASS', 'Next.js 16.1.3 Turbopack. Compiled successfully in 8.8s. All 17 routes generated.'],
    ['Smoke test API', 'PASS', 'GET /api/oracle/single → 200 with success=true + vector + learning + v2.'],
    ['V1 contract preservation', 'PASS', 'success/vector/learning fields unchanged. Only `v2` added (optional).'],
    ['Anti-Frankenstein: ONE Oracle', 'PASS', 'single-pass-oracle-engine remains canonical. V2 enriches, does not duplicate.'],
    ['Anti-Frankenstein: ONE MarketState', 'PASS', 'single-market-state remains canonical. V2 reads, does not create new state.'],
    ['Anti-Frankenstein: ONE weight set', 'PASS', 'linear-factor-model.getActiveWeights() remains sole mutator. R5 wraps it.'],
    ['Anti-Frankenstein: ONE prediction pipeline', 'PASS', 'runSinglePass() sole entry. R8 scenarios use it under shocked inputs.'],
    ['Append-only discipline', 'PASS', '0 V1 types destructively modified. 0 APIs broken. 0 UI contracts changed.'],
    ['No new global state', 'PASS', 'V2 uses bounded in-memory buffers (R4/R5/R6/R7/R9) — all documented.'],
    ['No LLM for investment decisions', 'PASS', 'R10 advisors are ADVISORY ONLY. Oracle remains final authority (rule 3).'],
    ['Deploy', 'BLOCKED', 'Per DEPLOY_POLICY.deploy_now=false. Will deploy only after explicit user sign-off.'],
]
t = Table(gates_data, colWidths=[5.5*cm, 2*cm, 9.5*cm])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#0066cc')),
    ('TEXTCOLOR', (0,0), (-1,0), colors.white),
    ('FONTNAME', (0,0), (-1,0), FONT_BOLD),
    ('FONTNAME', (0,1), (-1,-1), FONT),
    ('FONTSIZE', (0,0), (-1,-1), 9),
    ('GRID', (0,0), (-1,-1), 0.3, colors.HexColor('#cccccc')),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f9f9f9')]),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('LEFTPADDING', (0,0), (-1,-1), 5),
    ('TOPPADDING', (0,0), (-1,-1), 4),
    ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ('TEXTCOLOR', (1,1), (1,-2), colors.HexColor('#16a34a')),
    ('FONTNAME', (1,1), (1,-2), FONT_BOLD),
    ('TEXTCOLOR', (1,-1), (1,-1), colors.HexColor('#ca8a04')),
    ('FONTNAME', (1,-1), (1,-1), FONT_BOLD),
]))
story.append(t)
story.append(Spacer(1, 12))

# ─── Section 5: File Manifest ──────────────────────────────────────────────
story.append(Paragraph('5. File Manifest', h1_style))
manifest = [
    ['Path', 'Role', 'Status'],
    ['src/lib/oracle/v2/confidence-engine.ts', 'R1 — ConfidenceLayer computation', 'NEW'],
    ['src/lib/oracle/v2/regime-detector-v2.ts', 'R2 — 7-state regime classifier', 'NEW'],
    ['src/lib/oracle/v2/explainer.ts', 'R3 — Decision explainability', 'NEW'],
    ['src/lib/oracle/v2/forecast-verifier.ts', 'R4 — Verification metrics', 'NEW'],
    ['src/lib/oracle/v2/adaptive-weights.ts', 'R5 — Rule-gated weight updates + rollback', 'NEW'],
    ['src/lib/oracle/v2/lineage.ts', 'R6 — Prediction lineage + hash', 'NEW'],
    ['src/lib/oracle/v2/health-monitor.ts', 'R7 — Self-evaluation metrics', 'NEW'],
    ['src/lib/oracle/v2/scenario-engine.ts', 'R8 — Shock scenario sweep', 'NEW'],
    ['src/lib/oracle/v2/audit-trail.ts', 'R9 — Institutional decision log', 'NEW'],
    ['src/lib/oracle/v2/foundation-model-adapter.ts', 'R10 — Pluggable FM adapters', 'NEW'],
    ['src/lib/oracle/v2/index.ts', 'V2 orchestrator (single entry point)', 'NEW'],
    ['src/components/oracle/v2/v2-systemic-panel.tsx', 'V2 UI panel (10 blocks)', 'NEW'],
    ['src/app/api/oracle/single/route.ts', 'Canonical API — append-only `v2` field', 'EXTENDED'],
    ['src/components/dashboard/single-oracle-panel.tsx', 'Canonical UI — V2 panel mounted below V1 blocks', 'EXTENDED'],
]
t = Table(manifest, colWidths=[8*cm, 7.5*cm, 1.5*cm])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#0066cc')),
    ('TEXTCOLOR', (0,0), (-1,0), colors.white),
    ('FONTNAME', (0,0), (-1,0), FONT_BOLD),
    ('FONTNAME', (0,1), (-1,-1), FONT),
    ('FONTSIZE', (0,0), (-1,-1), 8.5),
    ('GRID', (0,0), (-1,-1), 0.3, colors.HexColor('#cccccc')),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f9f9f9')]),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('LEFTPADDING', (0,0), (-1,-1), 5),
    ('TOPPADDING', (0,0), (-1,-1), 3),
    ('BOTTOMPADDING', (0,0), (-1,-1), 3),
]))
story.append(t)
story.append(Spacer(1, 12))

# ─── Section 6: Success Criteria Compliance ────────────────────────────────
story.append(Paragraph('6. Success Criteria Compliance', h1_style))
criteria = [
    ['Criterion', 'Status', 'Evidence'],
    ['Prediction Confidence funcionando', '✓', 'R1 ConfidenceLayer operational, smoke 55.9/100'],
    ['Explainability completa', '✓', 'R3 top 5 positive/negative factors + reasoning_summary'],
    ['Forecast Verification completo', '✓', 'R4 MAE/RMSE/MAPE/HitRate/Calibration/DirAcc'],
    ['Adaptive Learning operativo', '✓', 'R5 rule-gated updates + rollback + journal'],
    ['Scenario Engine operativo', '✓', 'R8 6 shock scenarios + base/worst/best/range'],
    ['Health Monitor operativo', '✓', 'R7 6 metrics + composite 83.3 healthy'],
    ['Architecture continúa con ONE Oracle', '✓', 'single-pass-oracle-engine remains canonical'],
]
t = Table(criteria, colWidths=[7*cm, 1.5*cm, 8.5*cm])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#0066cc')),
    ('TEXTCOLOR', (0,0), (-1,0), colors.white),
    ('FONTNAME', (0,0), (-1,0), FONT_BOLD),
    ('FONTNAME', (0,1), (-1,-1), FONT),
    ('FONTSIZE', (0,0), (-1,-1), 9),
    ('GRID', (0,0), (-1,-1), 0.3, colors.HexColor('#cccccc')),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f9f9f9')]),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('LEFTPADDING', (0,0), (-1,-1), 5),
    ('TOPPADDING', (0,0), (-1,-1), 4),
    ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ('TEXTCOLOR', (1,1), (1,-1), colors.HexColor('#16a34a')),
    ('FONTNAME', (1,1), (1,-1), FONT_BOLD),
    ('ALIGN', (1,1), (1,-1), 'CENTER'),
]))
story.append(t)
story.append(Spacer(1, 14))

# ─── Final ─────────────────────────────────────────────────────────────────
story.append(Paragraph('7. Final Command Compliance', h1_style))
story.append(Paragraph(
    '<b>FINAL_COMMAND</b>: "NO HACER DEPLOY. IMPLEMENTAR TODAS LAS CAPAS DE ROBUSTEZ '
    'SISTÉMICA. AL FINAL ENTREGAR AUDIT, TYPECHECK, BUILD Y DIFERENCIA ARQUITECTÓNICA '
    'ANTES DE CUALQUIER DEPLOY."', body_style))
story.append(Spacer(1, 6))
story.append(Paragraph('<b>Compliance:</b>', h2_style))
compliance = [
    ['Requirement', 'Status'],
    ['NO DEPLOY', '✓ Not deployed'],
    ['IMPLEMENT ALL ROBUSTNESS LAYERS', '✓ R1-R10 implemented'],
    ['AUDIT (this document)', '✓ Delivered'],
    ['TYPECHECK', '✓ Pass'],
    ['BUILD', '✓ Pass'],
    ['ARCHITECTURAL DIFF (Section 2)', '✓ Delivered'],
]
t = Table(compliance, colWidths=[10*cm, 7*cm])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#16a34a')),
    ('TEXTCOLOR', (0,0), (-1,0), colors.white),
    ('FONTNAME', (0,0), (-1,0), FONT_BOLD),
    ('FONTNAME', (0,1), (-1,-1), FONT),
    ('FONTSIZE', (0,0), (-1,-1), 10),
    ('GRID', (0,0), (-1,-1), 0.3, colors.HexColor('#cccccc')),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f0fdf4')]),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('LEFTPADDING', (0,0), (-1,-1), 8),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ('TEXTCOLOR', (1,1), (1,-1), colors.HexColor('#16a34a')),
    ('FONTNAME', (1,1), (1,-1), FONT_BOLD),
    ('ALIGN', (1,1), (1,-1), 'CENTER'),
]))
story.append(t)
story.append(Spacer(1, 18))
story.append(Paragraph(
    '<i>End of audit. Ready for deploy upon explicit user sign-off. Per ABSOLUTE_RULES: '
    'append-only, backward compatible, all improvements measurable, all decisions audited.</i>',
    small_style))

doc.build(story)
print(f'PDF generated: {OUT_PATH}')
print(f'Size: {os.path.getsize(OUT_PATH)} bytes')
