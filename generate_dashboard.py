#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Portfolio Dashboard - Santander Argentina 30 dias
"""

import os, sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    CondPageBreak, HRFlowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

# Fonts
pdfmetrics.registerFont(TTFont('NotoSerifSC', '/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-Bold', '/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
pdfmetrics.registerFont(TTFont('SarasaMonoSC', '/usr/share/fonts/truetype/chinese/SarasaMonoSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSerif', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSerif-Bold', '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSans', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSans-Bold', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))

registerFontFamily('DejaVuSerif', normal='DejaVuSerif', bold='DejaVuSerif-Bold')
registerFontFamily('DejaVuSans', normal='DejaVuSans', bold='DejaVuSans-Bold')

PDF_SKILL_DIR = '/home/z/my-project/skills/pdf'
_scripts = os.path.join(PDF_SKILL_DIR, 'scripts')
if _scripts not in sys.path:
    sys.path.insert(0, _scripts)
try:
    from pdf import install_font_fallback
    install_font_fallback()
except: pass

# Palette
ACCENT = colors.HexColor('#1d951d')
TEXT_PRIMARY = colors.HexColor('#1b1c1e')
TEXT_MUTED = colors.HexColor('#7b8188')
BG_SURFACE = colors.HexColor('#dee2e6')
BG_PAGE = colors.HexColor('#f2f3f4')
GREEN_DARK = colors.HexColor('#166516')
RED_DARK = colors.HexColor('#991b1b')
AMBER = colors.HexColor('#b45309')
BLUE_DARK = colors.HexColor('#1e40af')

TABLE_HEADER_COLOR = ACCENT
TABLE_HEADER_TEXT = colors.white
TABLE_ROW_EVEN = colors.white
TABLE_ROW_ODD = BG_SURFACE

page_w, page_h = A4
lm = 0.85*inch; rm = 0.85*inch
aw = page_w - lm - rm  # available width

# Styles
FN = 'DejaVuSerif'
FNB = 'DejaVuSans'
h1 = ParagraphStyle('H1', fontName=FN, fontSize=16, leading=22, textColor=ACCENT, spaceBefore=14, spaceAfter=8, alignment=TA_LEFT)
h2 = ParagraphStyle('H2', fontName=FN, fontSize=13, leading=18, textColor=TEXT_PRIMARY, spaceBefore=12, spaceAfter=6, alignment=TA_LEFT)
h3 = ParagraphStyle('H3', fontName=FN, fontSize=11, leading=16, textColor=TEXT_PRIMARY, spaceBefore=8, spaceAfter=4, alignment=TA_LEFT)
body = ParagraphStyle('Body', fontName=FN, fontSize=10, leading=15, textColor=TEXT_PRIMARY, spaceBefore=2, spaceAfter=4, alignment=TA_JUSTIFY)
callout = ParagraphStyle('Callout', fontName=FN, fontSize=10.5, leading=16, textColor=GREEN_DARK, spaceBefore=6, spaceAfter=6, alignment=TA_LEFT, leftIndent=10, backColor=colors.HexColor('#f0faf0'), borderPadding=8)
callout_red = ParagraphStyle('CalloutRed', fontName=FN, fontSize=10.5, leading=16, textColor=RED_DARK, spaceBefore=6, spaceAfter=6, alignment=TA_LEFT, leftIndent=10, backColor=colors.HexColor('#fef2f2'), borderPadding=8)
callout_amber = ParagraphStyle('CalloutAmber', fontName=FN, fontSize=10.5, leading=16, textColor=AMBER, spaceBefore=6, spaceAfter=6, alignment=TA_LEFT, leftIndent=10, backColor=colors.HexColor('#fffbeb'), borderPadding=8)
caption = ParagraphStyle('Cap', fontName=FN, fontSize=8.5, leading=12, textColor=TEXT_MUTED, spaceBefore=2, spaceAfter=6, alignment=TA_CENTER)
th_s = ParagraphStyle('TH', fontName=FNB, fontSize=9, textColor=colors.white, alignment=TA_CENTER, leading=13)
td_s = ParagraphStyle('TD', fontName=FN, fontSize=9, textColor=TEXT_PRIMARY, alignment=TA_CENTER, leading=12)
td_l = ParagraphStyle('TDL', fontName=FN, fontSize=9, textColor=TEXT_PRIMARY, alignment=TA_LEFT, leading=12)
mono_s = ParagraphStyle('Mono', fontName='SarasaMonoSC', fontSize=9, textColor=TEXT_PRIMARY, alignment=TA_LEFT, leading=14, leftIndent=12)
dash_title = ParagraphStyle('DashTitle', fontName=FNB, fontSize=14, leading=20, textColor=colors.white, spaceBefore=0, spaceAfter=0, alignment=TA_CENTER)
dash_sub = ParagraphStyle('DashSub', fontName=FN, fontSize=10, leading=14, textColor=colors.HexColor('#d1fae5'), spaceBefore=0, spaceAfter=0, alignment=TA_CENTER)

def make_table(data, cw=None, has_header=True):
    if cw is None:
        cw = [aw / len(data[0])] * len(data[0])
    t = Table(data, colWidths=cw, hAlign='CENTER')
    cmds = [
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('GRID', (0,0), (-1,-1), 0.4, TEXT_MUTED),
    ]
    if has_header:
        cmds.extend([
            ('BACKGROUND', (0,0), (-1,0), TABLE_HEADER_COLOR),
            ('TEXTCOLOR', (0,0), (-1,0), TABLE_HEADER_TEXT),
        ])
        for i in range(1, len(data)):
            bg = TABLE_ROW_EVEN if i%2==1 else TABLE_ROW_ODD
            cmds.append(('BACKGROUND', (0,i), (-1,i), bg))
    t.setStyle(TableStyle(cmds))
    return t

def hr():
    return HRFlowable(width="100%", thickness=0.8, color=ACCENT, spaceBefore=4, spaceAfter=4)

def green_box(text):
    return Paragraph(text, callout)

def red_box(text):
    return Paragraph(text, callout_red)

def amber_box(text):
    return Paragraph(text, callout_amber)

# ============================================================
# BUILD
# ============================================================
output_path = '/home/z/my-project/download/Portfolio_Dashboard_Santander_30d.pdf'

doc = SimpleDocTemplate(output_path, pagesize=A4, leftMargin=lm, rightMargin=rm,
    topMargin=0.7*inch, bottomMargin=0.7*inch,
    title='Portfolio Dashboard - Santander Argentina 30 Dias',
    author='Z.ai', creator='Z.ai')

story = []

# ── DASHBOARD HEADER ──
header_data = [[
    Paragraph('<b>PORTFOLIO DASHBOARD - SANTANDER ARG</b>', dash_title),
]]
header_tbl = Table(header_data, colWidths=[aw], hAlign='CENTER')
header_tbl.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), ACCENT),
    ('LEFTPADDING', (0,0), (-1,-1), 12),
    ('RIGHTPADDING', (0,0), (-1,-1), 12),
    ('TOPPADDING', (0,0), (-1,-1), 14),
    ('BOTTOMPADDING', (0,0), (-1,-1), 14),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
]))
story.append(header_tbl)
story.append(Spacer(1, 4))

sub_data = [[
    Paragraph('Horizonte: 30 dias | Capital: USD 2.000 | Perfil: Conservador-Bajo Riesgo | Fecha: Junio 2026', dash_sub),
]]
sub_tbl = Table(sub_data, colWidths=[aw], hAlign='CENTER')
sub_tbl.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#166516')),
    ('LEFTPADDING', (0,0), (-1,-1), 8),
    ('TOPPADDING', (0,0), (-1,-1), 6),
    ('BOTTOMPADDING', (0,0), (-1,-1), 6),
]))
story.append(sub_tbl)
story.append(Spacer(1, 12))

# ════════════════════════════════════════════════════════════════
# 1. MACROECONOMIA 30 DIAS
# ════════════════════════════════════════════════════════════════
story.extend([CondPageBreak(80), Paragraph('<b>1. Macroeconomia Argentina - Ventana 30 Dias</b>', h1)])

story.append(Paragraph(
    'El escenario macro de junio a julio 2026 se caracteriza por una desaceleracion inflacionaria '
    'confirmada pero con riesgos de reversion. Segun el REM del BCRA de junio 2026, la inflacion '
    'de mayo se estimo en 2,3%, la de junio en 2,1% y la de julio en 1,9%, con un dolar minorista '
    'proyectado a $1.422 en junio y $1.447 en julio (top 10 consultoras). El tipo de cambio mayorista '
    'se proyecta en $1.658 para diciembre 2026, lo que implica una devaluacion mensual promedio del '
    '1,2%. Sin embargo, el dolar ha mostrado presiones alcistas en las primeras semanas de junio, '
    'tocando $1.460 minorista, lo que genera incertidumbre sobre si el crawling se acelera. La tasa '
    'de politica monetaria se ubica en el 65% con tendencia a la baja, y la TAMAR proyectada para '
    'diciembre 2026 es del 22,1% nominal anual.',
    body
))

# Macro 30d table
macro_data = [
    [Paragraph('<b>Variable</b>', th_s), Paragraph('<b>Valor Actual</b>', th_s),
     Paragraph('<b>Proyeccion 30d</b>', th_s), Paragraph('<b>Impacto Portafolio</b>', th_s)],
    [Paragraph('Inflacion mensual', td_l), Paragraph('2,3% (may)', td_s),
     Paragraph('2,1% (jun)', td_s), Paragraph('Erosiona retorno nominal', td_s)],
    [Paragraph('TC minorista', td_l), Paragraph('$1.460', td_s),
     Paragraph('$1.447 (jul)', td_s), Paragraph('Deval. implicita ~1,0%', td_s)],
    [Paragraph('TC mayorista', td_l), Paragraph('$1.438', td_s),
     Paragraph('$1.444 (jul)', td_s), Paragraph('Crawling ~0,4% mensual', td_s)],
    [Paragraph('Dolar MEP', td_l), Paragraph('$1.460', td_s),
     Paragraph('$1.460-1.490', td_s), Paragraph('Brecha minima historica', td_s)],
    [Paragraph('Tasa politica BCRA', td_l), Paragraph('65% TNA', td_s),
     Paragraph('60-65% TNA', td_s), Paragraph('Compresion carry', td_s)],
    [Paragraph('Tasa PF Santander', td_l), Paragraph('15% TNA', td_s),
     Paragraph('15% TNA', td_s), Paragraph('Real negativo severo', td_s)],
    [Paragraph('FCI Money Market', td_l), Paragraph('~25% TNA', td_s),
     Paragraph('~23-25% TNA', td_s), Paragraph('Real marginal positivo', td_s)],
]
story.append(Spacer(1, 8))
story.append(make_table(macro_data, [aw*0.24, aw*0.20, aw*0.22, aw*0.34]))
story.append(Paragraph('Tabla 1: Variables macro clave y proyeccion 30 dias', caption))
story.append(Spacer(1, 6))

story.append(green_box(
    '<b>Veredicto macro 30 dias:</b> Inflacion ~2,1% mensual, devaluacion implicita MEP ~1,0-1,5% '
    'mensual, tasa real en pesos levemente positiva para FCI money market (~0,3% real mensual) y '
    'positiva para CER (~1,0% real mensual). Probabilidad de salto cambiario en 30 dias: baja (10-15%). '
    'Escenario dominante: crawling peg gradual dentro de bandas.'
))

story.append(Spacer(1, 12))

# ════════════════════════════════════════════════════════════════
# 2. TASAS REALES
# ════════════════════════════════════════════════════════════════
story.append(Paragraph('<b>2. Tasas Reales vs Inflacion</b>', h1))

# Calculo: inflacion 30d esperada ~2.1%, devaluacion ~1.0%
inf_30 = 0.021
dev_30 = 0.010

story.append(Paragraph(
    'La formula de retorno real es: (1 + tasa nominal) / (1 + inflacion esperada) - 1. Con inflacion '
    'esperada de 2,1% para los proximos 30 dias, los instrumentos en pesos deben superar esa barrera '
    'para generar retorno real positivo. El break-even carry trade (tasa en pesos vs devaluacion) se '
    'ubica en: la tasa nominal debe superar la devaluacion del 1,0% para que el carry sea positivo. '
    'A continuacion se calculan los retornos reales para cada instrumento disponible en Santander.',
    body
))

tasas_data = [
    [Paragraph('<b>Instrumento</b>', th_s), Paragraph('<b>TNA</b>', th_s),
     Paragraph('<b>Rend. 30d nom.</b>', th_s), Paragraph('<b>Infl. 30d</b>', th_s),
     Paragraph('<b>Rend. Real 30d</b>', th_s)],
    [Paragraph('Super Ahorro $ (MM)', td_l), Paragraph('25%', td_s),
     Paragraph('1,99%', td_s), Paragraph('2,10%', td_s),
     Paragraph('-0,11%', td_s)],
    [Paragraph('Supergestion Mix VI', td_l), Paragraph('27%', td_s),
     Paragraph('2,14%', td_s), Paragraph('2,10%', td_s),
     Paragraph('+0,04%', td_s)],
    [Paragraph('Superfondo Renta Fija CER', td_l), Paragraph('35%', td_s),
     Paragraph('2,75%', td_s), Paragraph('2,10%', td_s),
     Paragraph('+0,64%', td_s)],
    [Paragraph('Plazo Fijo Santander 30d', td_l), Paragraph('15%', td_s),
     Paragraph('1,19%', td_s), Paragraph('2,10%', td_s),
     Paragraph('-0,89%', td_s)],
    [Paragraph('Dolar MEP (hold)', td_l), Paragraph('N/A', td_s),
     Paragraph('~1,0%', td_s), Paragraph('2,10% (en ARS)', td_s),
     Paragraph('-1,1% (en ARS)', td_s)],
]
story.append(Spacer(1, 8))
story.append(make_table(tasas_data, [aw*0.28, aw*0.12, aw*0.18, aw*0.16, aw*0.26]))
story.append(Paragraph('Tabla 2: Ranking de retorno real a 30 dias por instrumento Santander', caption))
story.append(Spacer(1, 6))

# Break-even
story.append(Paragraph('<b>Break-even USD/ARS (MEP vs Carry Trade)</b>', h3))
story.append(Paragraph(
    'El carry trade en pesos es rentable mientras la tasa en pesos supere la devaluacion. Con una '
    'tasa de FCI money market del 25% TNA (~1,99% mensual) y una devaluacion esperada del 1,0% '
    'mensual, el carry rinde ~+0,99% mensual en USD. Solo si el dolar se devalua mas del 2,0% '
    'mensual (break-even), conviene haber dolarizado. El break-even MEP vs carry se ubica en una '
    'devaluacion del ~2,0% en 30 dias, por encima de la expectativa base del 1,0%. Por lo tanto, '
    'estar en pesos es optimo en el escenario base, con cobertura USD parcial como insurance.',
    body
))

story.append(Spacer(1, 12))

# ════════════════════════════════════════════════════════════════
# 3. FONDOS SANTANDER - ANALISIS COMPARATIVO
# ════════════════════════════════════════════════════════════════
story.append(Paragraph('<b>3. Fondos Santander - Analisis Comparativo</b>', h1))

# Super Ahorro $
story.append(Paragraph('<b>3.1 Super Ahorro $ (Money Market Clasico)</b>', h3))
story.append(Paragraph(
    'El Super Ahorro $ es el fondo money market de Santander Argentina, orientado a la preservacion '
    'de capital con liquidez inmediata (T+0/T+1). Invierte principalmente en plazos fijos, LEBACs, '
    'letras del BCRA y otros instrumentos de muy corto plazo con riesgo de credito minimo. Su TNA '
    'actual ronda el 25%, con variacion diaria del orden del 0,07-0,14%. El patrimonio del fondo es '
    'de aproximadamente $4,48 billones, lo que lo convierte en uno de los fondos mas grandes del '
    'mercado argentino. La liquidez es su principal ventaja: permite rescatar en el dia (T+0 para '
    'montos habituales) o en 24 horas habiles, lo que lo hace ideal como nucleo defensivo del '
    'portafolio. Su drawdown maximo historico en ventanas de 30 dias es inferior al 0,3%, '
    'convirtiendolo en el instrumento mas seguro dentro del ecosistema Santander en pesos.',
    body
))

# Supergestion Mix VI
story.append(Paragraph('<b>3.2 Supergestion Mix VI (Renta Fija Corto Plazo)</b>', h3))
story.append(Paragraph(
    'El Supergestion Mix VI es un fondo de renta fija que da "un pasito mas" respecto del money '
    'market, buscando mayor rendimiento asumiendo un poco mas de riesgo. Su composicion incluye '
    'bonos de corto plazo, letras y algunos bonos CER cortos, con un horizonte de inversion '
    'sugerido de 1 mes. El plazo de liquidacion es T+1 (24 horas habiles). Su variacion diaria '
    'promedia el 0,11%, lo que sugiere una TNA en el rango del 27%. La calificacion FIX SCR es '
    'AAf(arg). Si bien el rendimiento es superior al Super Ahorro $, la duration promedio de la '
    'cartera es mayor (~0,3-0,5 anos), lo que implica una sensibilidad ligeramente superior a '
    'cambios en las tasas de interes. El drawdown maximo estimado en 30 dias es del 0,5-1,0%, '
    'significativamente mayor que el Super Ahorro $ pero aun dentro de un rango aceptable para '
    'un perfil conservador.',
    body
))

# Superfondo Renta Fija CER
story.append(Paragraph('<b>3.3 Superfondo Renta Fija CER</b>', h3))
story.append(Paragraph(
    'El Superfondo Renta Fija es un fondo de renta fija CER calificado AAf(arg) con plazo de '
    'liquidacion T+2 (48 horas habiles). Su composicion incluye bonos CER como TZXO6 (vto. '
    '30/10/2026, 20,18% de la cartera), TZXD6 (vto. 15/12/2026, 19,66%) y TZXM7 (vto. '
    '31/03/2027), entre otros. La TNA estimada es del 35%, con rendimiento mensual del ~2,75%. '
    'Su principal ventaja es la cobertura inflacionaria: al ajustar por CER, el capital se preserva '
    'en terminos reales mas un spread positivo. Sin embargo, la duration efectiva promedio de la '
    'cartera es de ~0,4-0,6 anos, lo que implica una sensibilidad moderada a cambios en las tasas '
    'reales. El drawdown maximo estimado en 30 dias es del 1,0-2,0%, aceptable para el componente '
    'de cobertura inflacionaria del portafolio. La liquidez T+2 es ligeramente inferior al Super '
    'Ahorro $ pero aun razonable para un horizonte de 30 dias.',
    body
))

# Superfondo Ahorro USD
story.append(Paragraph('<b>3.4 Superfondo Ahorro USD</b>', h3))
story.append(Paragraph(
    'El Superfondo Ahorro USD es un fondo money market denominado en dolares con monto minimo de '
    'USD 100 y rescate en 48 horas habiles. Invierte en instrumentos de deuda de corto plazo en '
    'dolares, principalmente deuda corporativa argentina y latinoamericana. Su rendimiento anualizado '
    'es muy bajo en terminos de USD (~3-5% TNA en dolares), consistente con las tasas internacionales '
    'para instrumentos de bajo riesgo en moneda dura. La funcion principal de este fondo dentro del '
    'portafolio NO es generar retorno sino proporcionar exposicion al tipo de cambio como cobertura '
    'macro. En terminos de pesos, su rendimiento depende enteramente de la evolucion del tipo de '
    'cambio: si el dolar sube 1,0% en 30 dias, el retorno en pesos es ~1,0% + el cupon del 0,3% '
    'mensual del fondo. El drawdown en USD es minimo (<0,2% en 30 dias), pero en terminos de pesos '
    'puede ser significativo si el tipo de cambio se aprecia (pesos se fortalecen).',
    body
))

# Comparativo consolidado
comp_data = [
    [Paragraph('<b>Fondo</b>', th_s), Paragraph('<b>TNA</b>', th_s),
     Paragraph('<b>Rend. 30d</b>', th_s), Paragraph('<b>Real 30d</b>', th_s),
     Paragraph('<b>Liquidez</b>', th_s), Paragraph('<b>DD Max 30d</b>', th_s),
     Paragraph('<b>Riesgo</b>', th_s)],
    [Paragraph('Super Ahorro $', td_l), Paragraph('25%', td_s), Paragraph('2,0%', td_s),
     Paragraph('-0,1%', td_s), Paragraph('T+0/T+1', td_s), Paragraph('<0,3%', td_s), Paragraph('Muy bajo', td_s)],
    [Paragraph('Supergestion Mix VI', td_l), Paragraph('27%', td_s), Paragraph('2,1%', td_s),
     Paragraph('+0,0%', td_s), Paragraph('T+1', td_s), Paragraph('0,5-1,0%', td_s), Paragraph('Bajo', td_s)],
    [Paragraph('SF Renta Fija CER', td_l), Paragraph('35%', td_s), Paragraph('2,8%', td_s),
     Paragraph('+0,6%', td_s), Paragraph('T+2', td_s), Paragraph('1,0-2,0%', td_s), Paragraph('Bajo-Med', td_s)],
    [Paragraph('SF Ahorro USD', td_l), Paragraph('~4% USD', td_s), Paragraph('~1,3% ARS', td_s),
     Paragraph('-0,8% ARS', td_s), Paragraph('T+2', td_s), Paragraph('<0,2% USD', td_s), Paragraph('Bajo (FX)', td_s)],
]
story.append(Spacer(1, 8))
story.append(make_table(comp_data, [aw*0.18, aw*0.10, aw*0.12, aw*0.12, aw*0.12, aw*0.16, aw*0.20]))
story.append(Paragraph('Tabla 3: Comparativo consolidado de Superfondos Santander - 30 dias', caption))

story.append(Spacer(1, 14))

# ════════════════════════════════════════════════════════════════
# 4. PORTAFOLIOS OPTIMIZADOS
# ════════════════════════════════════════════════════════════════
story.append(Paragraph('<b>4. Optimizacion de Portafolio</b>', h1))

# ── PORTAFOLIO CONSERVADOR ──
story.append(Paragraph('<b>4.1 Portafolio Conservador (Blindaje Total)</b>', h2))
story.append(Paragraph(
    'Objetivo: preservacion de capital con maxima liquidez y minima volatilidad. Este portafolio '
    'prioriza la seguridad absoluta sobre el retorno, concentrando la mayoria del capital en el '
    'fondo money market y manteniendo una exposicion minima a CER como cobertura inflacionaria '
    'basica y una posicion tokenica en USD como insurance macro. El drawdown estimado en el peor '
    'escenario (shock cambiario + suba de tasas) es inferior al 1,5%, y la liquidez ponderada '
    'promedio es de T+0,3, lo que significa que mas del 70% del capital puede rescatarse en el dia.',
    body
))

# Allocations - Conservative
# Capital: USD 2000 = ARS 2,920,000 at 1460
cons_data = [
    [Paragraph('<b>Instrumento</b>', th_s), Paragraph('<b>Monto USD</b>', th_s),
     Paragraph('<b>%</b>', th_s), Paragraph('<b>Rend. 30d nom.</b>', th_s),
     Paragraph('<b>Rend. Real 30d</b>', th_s), Paragraph('<b>Ganancia USD est.</b>', th_s)],
    [Paragraph('Super Ahorro $', td_l), Paragraph('1.400', td_s), Paragraph('70%', td_s),
     Paragraph('2,0%', td_s), Paragraph('-0,1%', td_s), Paragraph('~USD 14', td_s)],
    [Paragraph('Superfondo Renta Fija CER', td_l), Paragraph('400', td_s), Paragraph('20%', td_s),
     Paragraph('2,8%', td_s), Paragraph('+0,6%', td_s), Paragraph('~USD 6', td_s)],
    [Paragraph('Superfondo Ahorro USD', td_l), Paragraph('200', td_s), Paragraph('10%', td_s),
     Paragraph('1,3% (ARS)', td_s), Paragraph('-0,8% (ARS)', td_s), Paragraph('~USD 1', td_s)],
    [Paragraph('<b>TOTAL</b>', td_l), Paragraph('<b>2.000</b>', td_s), Paragraph('<b>100%</b>', td_s),
     Paragraph('<b>~2,1%</b>', td_s), Paragraph('<b>~0,0%</b>', td_s), Paragraph('<b>~USD 21</b>', td_s)],
]
story.append(Spacer(1, 8))
story.append(make_table(cons_data, [aw*0.24, aw*0.14, aw*0.10, aw*0.16, aw*0.16, aw*0.20]))
story.append(Paragraph('Tabla 4: Portafolio Conservador - Asignacion y rendimientos estimados 30 dias', caption))
story.append(Spacer(1, 6))

story.append(green_box(
    '<b>Portafolio Conservador:</b> Ganancia estimada ~USD 21 (+1,05% del capital) en 30 dias. '
    'Rango conservador: USD +10 a +15. Rango optimista: USD +25 a +35. Drawdown maximo estimado: <1,5%. '
    'Liquidez promedio: T+0,3. Exposicion FX: 10%. Exposicion inflacion: 20% cubierta via CER.'
))

story.append(Spacer(1, 10))

# ── PORTAFOLIO OPTIMIZADO ──
story.append(Paragraph('<b>4.2 Portafolio Optimizado (Carry + Inflacion)</b>', h2))
story.append(Paragraph(
    'Objetivo: maximizar retorno real sin romper la restriccion de bajo riesgo. Este portafolio '
    'reduce la posicion en money market para incrementar la exposicion a CER (cobertura '
    'inflacionaria con retorno real positivo) y aumenta la posicion en Supergestion Mix VI para '
    'capturar el spread de carry. La exposicion USD se mantiene como insurance pero se reduce al '
    'minimo dado que el carry en pesos es favorable en el escenario base. El drawdown estimado en '
    'el peor escenario es del 2-3%, dentro del umbral aceptable para "bajo riesgo". La liquidez '
    'ponderada promedio es T+1, lo que significa que el capital puede rescatarse en 24-48 horas.',
    body
))

opt_data = [
    [Paragraph('<b>Instrumento</b>', th_s), Paragraph('<b>Monto USD</b>', th_s),
     Paragraph('<b>%</b>', th_s), Paragraph('<b>Rend. 30d nom.</b>', th_s),
     Paragraph('<b>Rend. Real 30d</b>', th_s), Paragraph('<b>Ganancia USD est.</b>', th_s)],
    [Paragraph('Super Ahorro $', td_l), Paragraph('800', td_s), Paragraph('40%', td_s),
     Paragraph('2,0%', td_s), Paragraph('-0,1%', td_s), Paragraph('~USD 8', td_s)],
    [Paragraph('Supergestion Mix VI', td_l), Paragraph('400', td_s), Paragraph('20%', td_s),
     Paragraph('2,1%', td_s), Paragraph('+0,0%', td_s), Paragraph('~USD 4', td_s)],
    [Paragraph('Superfondo Renta Fija CER', td_l), Paragraph('700', td_s), Paragraph('35%', td_s),
     Paragraph('2,8%', td_s), Paragraph('+0,6%', td_s), Paragraph('~USD 10', td_s)],
    [Paragraph('Superfondo Ahorro USD', td_l), Paragraph('100', td_s), Paragraph('5%', td_s),
     Paragraph('1,3% (ARS)', td_s), Paragraph('-0,8% (ARS)', td_s), Paragraph('~USD 0,5', td_s)],
    [Paragraph('<b>TOTAL</b>', td_l), Paragraph('<b>2.000</b>', td_s), Paragraph('<b>100%</b>', td_s),
     Paragraph('<b>~2,3%</b>', td_s), Paragraph('<b>~+0,2%</b>', td_s), Paragraph('<b>~USD 23</b>', td_s)],
]
story.append(Spacer(1, 8))
story.append(make_table(opt_data, [aw*0.24, aw*0.14, aw*0.10, aw*0.16, aw*0.16, aw*0.20]))
story.append(Paragraph('Tabla 5: Portafolio Optimizado - Asignacion y rendimientos estimados 30 dias', caption))
story.append(Spacer(1, 6))

story.append(green_box(
    '<b>Portafolio Optimizado:</b> Ganancia estimada ~USD 23 (+1,15% del capital) en 30 dias. '
    'Rango conservador: USD +10 a +18. Rango optimista: USD +30 a +45. Drawdown maximo estimado: 2-3%. '
    'Liquidez promedio: T+1,1. Exposicion FX: 5%. Exposicion inflacion: 35% cubierta via CER.'
))

story.append(Spacer(1, 14))

# ════════════════════════════════════════════════════════════════
# 5. DASHBOARD PRINCIPAL (PORTAFOLIO RECOMENDADO)
# ════════════════════════════════════════════════════════════════
story.append(Paragraph('<b>5. Portfolio Dashboard - Resumen Ejecutivo</b>', h1))

# Dash header
dash_hdr = [[Paragraph('<b>PORTFOLIO DASHBOARD - SANTANDER ARG (30 dias)</b>', dash_title)]]
dash_hdr_tbl = Table(dash_hdr, colWidths=[aw], hAlign='CENTER')
dash_hdr_tbl.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), ACCENT),
    ('LEFTPADDING', (0,0), (-1,-1), 10), ('TOPPADDING', (0,0), (-1,-1), 10), ('BOTTOMPADDING', (0,0), (-1,-1), 10),
]))
story.append(dash_hdr_tbl)
story.append(Spacer(1, 4))

# Capital
cap_data = [[Paragraph('<b>Capital total: USD 2.000 (ARS 2.920.000 al TC $1.460)</b>', ParagraphStyle('cap', fontName=FNB, fontSize=10, leading=14, textColor=TEXT_PRIMARY, alignment=TA_CENTER))]]
cap_tbl = Table(cap_data, colWidths=[aw], hAlign='CENTER')
cap_tbl.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f0faf0')), ('TOPPADDING', (0,0), (-1,-1), 6), ('BOTTOMPADDING', (0,0), (-1,-1), 6)]))
story.append(cap_tbl)
story.append(Spacer(1, 8))

# Allocation section header
alloc_hdr = [[Paragraph('<b>ASIGNACION (Portafolio Optimizado)</b>', ParagraphStyle('ah', fontName=FNB, fontSize=10, leading=14, textColor=colors.white, alignment=TA_CENTER))]]
alloc_hdr_tbl = Table(alloc_hdr, colWidths=[aw], hAlign='CENTER')
alloc_hdr_tbl.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#166516')), ('TOPPADDING', (0,0), (-1,-1), 5), ('BOTTOMPADDING', (0,0), (-1,-1), 5)]))
story.append(alloc_hdr_tbl)

# Main allocation table
alloc_data = [
    [Paragraph('<b>Instrumento</b>', th_s), Paragraph('<b>Monto USD</b>', th_s),
     Paragraph('<b>%</b>', th_s), Paragraph('<b>Rend. esp. 30d</b>', th_s),
     Paragraph('<b>Ganancia USD</b>', th_s)],
    [Paragraph('Super Ahorro $', td_l), Paragraph('800', td_s), Paragraph('40%', td_s),
     Paragraph('2,0%', td_s), Paragraph('+8', td_s)],
    [Paragraph('Supergestion Mix VI', td_l), Paragraph('400', td_s), Paragraph('20%', td_s),
     Paragraph('2,1%', td_s), Paragraph('+4', td_s)],
    [Paragraph('Superfondo Renta Fija CER', td_l), Paragraph('700', td_s), Paragraph('35%', td_s),
     Paragraph('2,8%', td_s), Paragraph('+10', td_s)],
    [Paragraph('Superfondo Ahorro USD', td_l), Paragraph('100', td_s), Paragraph('5%', td_s),
     Paragraph('1,3%', td_s), Paragraph('+0,5', td_s)],
    [Paragraph('<b>TOTAL</b>', td_l), Paragraph('<b>2.000</b>', td_s), Paragraph('<b>100%</b>', td_s),
     Paragraph('<b>~2,3%</b>', td_s), Paragraph('<b>+23</b>', td_s)],
]
story.append(make_table(alloc_data, [aw*0.28, aw*0.16, aw*0.10, aw*0.20, aw*0.26]))
story.append(Spacer(1, 8))

# Resultado section
res_hdr = [[Paragraph('<b>RESULTADO TOTAL ESTIMADO</b>', ParagraphStyle('rh', fontName=FNB, fontSize=10, leading=14, textColor=colors.white, alignment=TA_CENTER))]]
res_hdr_tbl = Table(res_hdr, colWidths=[aw], hAlign='CENTER')
res_hdr_tbl.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,-1), ACCENT), ('TOPPADDING', (0,0), (-1,-1), 5), ('BOTTOMPADDING', (0,0), (-1,-1), 5)]))
story.append(res_hdr_tbl)

res_data = [
    [Paragraph('<b>Metrica</b>', th_s), Paragraph('<b>Valor</b>', th_s)],
    [Paragraph('Ganancia estimada USD', td_l), Paragraph('+USD 23', td_s)],
    [Paragraph('Ganancia %', td_l), Paragraph('+1,15%', td_s)],
    [Paragraph('Rango conservador', td_l), Paragraph('+USD 10 a +18 (0,5-0,9%)', td_s)],
    [Paragraph('Rango optimista', td_l), Paragraph('+USD 30 a +45 (1,5-2,3%)', td_s)],
    [Paragraph('Rango pesimista (shock parcial)', td_l), Paragraph('USD -5 a +5 (-0,3 a +0,3%)', td_s)],
]
story.append(Spacer(1, 4))
story.append(make_table(res_data, [aw*0.50, aw*0.50]))
story.append(Spacer(1, 8))

# Riesgo section
risk_hdr = [[Paragraph('<b>ANALISIS DE RIESGO</b>', ParagraphStyle('rkh', fontName=FNB, fontSize=10, leading=14, textColor=colors.white, alignment=TA_CENTER))]]
risk_hdr_tbl = Table(risk_hdr, colWidths=[aw], hAlign='CENTER')
risk_hdr_tbl.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#991b1b')), ('TOPPADDING', (0,0), (-1,-1), 5), ('BOTTOMPADDING', (0,0), (-1,-1), 5)]))
story.append(risk_hdr_tbl)

risk_data = [
    [Paragraph('<b>Riesgo</b>', th_s), Paragraph('<b>Nivel</b>', th_s), Paragraph('<b>Detalle</b>', th_s)],
    [Paragraph('Exposicion FX', td_l), Paragraph('5%', td_s), Paragraph('Solo 5% en USD, carry positivo en escenario base', td_l)],
    [Paragraph('Exposicion inflacion', td_l), Paragraph('35% cubierto', td_s), Paragraph('CER protege 35% del capital contra inflacion', td_l)],
    [Paragraph('Drawdown estimado 30d', td_l), Paragraph('2-3%', td_s), Paragraph('Max en escenario de suba de tasas + crawl acelerado', td_l)],
    [Paragraph('Sensibilidad a devaluacion', td_l), Paragraph('Baja', td_s), Paragraph('95% en pesos, solo 5% sensible a tipo de cambio', td_l)],
    [Paragraph('Riesgo liquidez', td_l), Paragraph('Muy bajo', td_s), Paragraph('40% T+0, 20% T+1, 35% T+2, 5% T+2 USD', td_l)],
]
story.append(Spacer(1, 4))
story.append(make_table(risk_data, [aw*0.22, aw*0.18, aw*0.60]))
story.append(Spacer(1, 12))

# ════════════════════════════════════════════════════════════════
# 6. UI SIMULADA - COPY BUTTONS
# ════════════════════════════════════════════════════════════════
story.append(Paragraph('<b>6. Instrucciones para Ejecucion Manual en Santander App</b>', h1))

story.append(Paragraph(
    'A continuacion se proporcionan las instrucciones paso a paso para replicar el portafolio '
    'optimizado directamente desde la app de Santander Argentina u Online Banking. Cada seccion '
    'contiene el texto listo para copiar y pegar en las pantallas correspondientes de la app.',
    body
))

# COPY PORTFOLIO
btn_hdr1 = [[Paragraph('[ COPY PORTFOLIO ]', ParagraphStyle('btn', fontName=FNB, fontSize=11, leading=15, textColor=colors.white, alignment=TA_CENTER))]]
btn_tbl1 = Table(btn_hdr1, colWidths=[aw], hAlign='CENTER')
btn_tbl1.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,-1), ACCENT), ('TOPPADDING', (0,0), (-1,-1), 8), ('BOTTOMPADDING', (0,0), (-1,-1), 8), ('ALIGN', (0,0), (-1,-1), 'CENTER')]))
story.append(Spacer(1, 6))
story.append(btn_tbl1)

copy_port = (
    '1. Abrir App Santander > Inversiones > Superfondos<br/>'
    '2. Super Ahorro $ > Invertir > ARS 1.168.000 (USD 800 eq.)<br/>'
    '3. Supergestion Mix VI > Invertir > ARS 584.000 (USD 400 eq.)<br/>'
    '4. Superfondo Renta Fija CER > Invertir > ARS 1.022.000 (USD 700 eq.)<br/>'
    '5. Ir a Dolar MEP > Comprar USD 100 con pesos<br/>'
    '6. Superfondo Ahorro USD > Invertir > USD 100<br/>'
    '7. Verificar asignacion: 40% MM + 20% Mix VI + 35% CER + 5% USD'
)
story.append(Paragraph(copy_port, mono_s))
story.append(Spacer(1, 8))

# COPY ALLOCATION
btn_hdr2 = [[Paragraph('[ COPY ALLOCATION ]', ParagraphStyle('btn2', fontName=FNB, fontSize=11, leading=15, textColor=colors.white, alignment=TA_CENTER))]]
btn_tbl2 = Table(btn_hdr2, colWidths=[aw], hAlign='CENTER')
btn_tbl2.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#1e40af')), ('TOPPADDING', (0,0), (-1,-1), 8), ('BOTTOMPADDING', (0,0), (-1,-1), 8)]))
story.append(btn_tbl2)

copy_alloc = (
    'Super Ahorro $: 40% = ARS 1.168.000 (T+0) -- Nucleo liquido<br/>'
    'Supergestion Mix VI: 20% = ARS 584.000 (T+1) -- Carry + spread<br/>'
    'SF Renta Fija CER: 35% = ARS 1.022.000 (T+2) -- Hedge inflacion<br/>'
    'SF Ahorro USD: 5% = USD 100 (T+2) -- Insurance macro<br/>'
    'Retorno real estimado 30d: +0,2% | Drawdown max: 2-3%'
)
story.append(Paragraph(copy_alloc, mono_s))
story.append(Spacer(1, 8))

# COPY REBALANCE
btn_hdr3 = [[Paragraph('[ COPY REBALANCE STRATEGY ]', ParagraphStyle('btn3', fontName=FNB, fontSize=11, leading=15, textColor=colors.white, alignment=TA_CENTER))]]
btn_tbl3 = Table(btn_hdr3, colWidths=[aw], hAlign='CENTER')
btn_tbl3.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,-1), AMBER), ('TOPPADDING', (0,0), (-1,-1), 8), ('BOTTOMPADDING', (0,0), (-1,-1), 8)]))
story.append(btn_tbl3)

copy_rebal = (
    'Dia 15 (checkpoint): Verificar inflacion real vs proyectada<br/>'
    'Si inflacion > 2,5% mensual: Mover 10% de Super Ahorro a CER<br/>'
    'Si dolar sube > 3% en 15 dias: Mover 5% CER a Ahorro USD<br/>'
    'Si dolar baja o estable: Mantener posicion en pesos<br/>'
    'Dia 25: Evaluar rescate anticipado si condiciones cambian<br/>'
    'Dia 30: Rescatar todo si se necesita liquidez, renovar si no<br/>'
    'Regla: Nunca superar 5% en USD salvo escenario de shock'
)
story.append(Paragraph(copy_rebal, mono_s))
story.append(Spacer(1, 14))

# ════════════════════════════════════════════════════════════════
# 7. ESCENARIOS OBLIGATORIOS
# ════════════════════════════════════════════════════════════════
story.append(Paragraph('<b>7. Simulacion de Escenarios - Impacto en USD Final</b>', h1))

story.append(Paragraph(
    'Los tres escenarios siguientes simulan el impacto sobre el valor final del portafolio optimizado '
    'a 30 dias, expresado en USD equivalentes. Los supuestos de cada escenario son coherentes con la '
    'dinamica macro argentina observada en los ultimos 12 meses y con las proyecciones del REM.',
    body
))

# ESCENARIO VERDE
story.append(Spacer(1, 6))
esc_v = [[Paragraph('<b>ESCENARIO VERDE - ESTABILIDAD (Probabilidad: 60%)</b>', ParagraphStyle('ev', fontName=FNB, fontSize=10, leading=14, textColor=colors.white, alignment=TA_CENTER))]]
esc_v_tbl = Table(esc_v, colWidths=[aw], hAlign='CENTER')
esc_v_tbl.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,-1), GREEN_DARK), ('TOPPADDING', (0,0), (-1,-1), 6), ('BOTTOMPADDING', (0,0), (-1,-1), 6)]))
story.append(esc_v_tbl)

story.append(Paragraph(
    'Inflacion controlada en 2,0-2,1%, tipo de cambio estable dentro de las bandas (devaluacion ~1,0%), '
    'tasas reales ligeramente positivas, BCRA continua comprando reservas, carry trade vigente. En este '
    'escenario, el componente CER genera retorno real positivo (+0,6%), el money market preserva capital '
    'con retorno real marginal (-0,1%), y el componente USD pierde levemente en terminos de pesos pero '
    'protege contra la cola de riesgo.',
    body
))

esc_v_data = [
    [Paragraph('<b>Instrumento</b>', th_s), Paragraph('<b>Rend. 30d</b>', th_s), Paragraph('<b>Ganancia USD</b>', th_s), Paragraph('<b>USD Final</b>', th_s)],
    [Paragraph('Super Ahorro $', td_l), Paragraph('2,0%', td_s), Paragraph('+8', td_s), Paragraph('808', td_s)],
    [Paragraph('Supergestion Mix VI', td_l), Paragraph('2,1%', td_s), Paragraph('+4', td_s), Paragraph('404', td_s)],
    [Paragraph('SF Renta Fija CER', td_l), Paragraph('2,8%', td_s), Paragraph('+10', td_s), Paragraph('710', td_s)],
    [Paragraph('SF Ahorro USD', td_l), Paragraph('1,3%', td_s), Paragraph('+0,5', td_s), Paragraph('100,5', td_s)],
    [Paragraph('<b>TOTAL</b>', td_l), Paragraph('<b>2,3%</b>', td_s), Paragraph('<b>+22,5</b>', td_s), Paragraph('<b>2.022,5</b>', td_s)],
]
story.append(Spacer(1, 4))
story.append(make_table(esc_v_data, [aw*0.30, aw*0.20, aw*0.22, aw*0.28]))
story.append(Paragraph('Escenario Verde: USD 2.022,5 (+1,13%)', caption))

# ESCENARIO AMARILLO
story.append(Spacer(1, 8))
esc_a = [[Paragraph('<b>ESCENARIO AMARILLO - DEVALUACION LEVE (Probabilidad: 25%)</b>', ParagraphStyle('ea', fontName=FNB, fontSize=10, leading=14, textColor=colors.white, alignment=TA_CENTER))]]
esc_a_tbl = Table(esc_a, colWidths=[aw], hAlign='CENTER')
esc_a_tbl.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,-1), AMBER), ('TOPPADDING', (0,0), (-1,-1), 6), ('BOTTOMPADDING', (0,0), (-1,-1), 6)]))
story.append(esc_a_tbl)

story.append(Paragraph(
    'El crawling se acelera levemente, el dolar sube un 5-10% en 30 dias, la inflacion sube al 3,0-3,5% '
    'mensual por pass-through cambiario. Las tasas reales se comprimen. El componente CER ajusta pero '
    'sufre mark-to-market negativa por duration. El componente USD gana significativamente. El money '
    'market pierde valor real.',
    body
))

esc_a_data = [
    [Paragraph('<b>Instrumento</b>', th_s), Paragraph('<b>Rend. 30d</b>', th_s), Paragraph('<b>Ganancia USD</b>', th_s), Paragraph('<b>USD Final</b>', th_s)],
    [Paragraph('Super Ahorro $', td_l), Paragraph('2,0% (real -1,5%)', td_s), Paragraph('+2', td_s), Paragraph('802', td_s)],
    [Paragraph('Supergestion Mix VI', td_l), Paragraph('1,0% (real -2,5%)', td_s), Paragraph('-2', td_s), Paragraph('398', td_s)],
    [Paragraph('SF Renta Fija CER', td_l), Paragraph('3,5% (CER ajusta)', td_s), Paragraph('+5', td_s), Paragraph('705', td_s)],
    [Paragraph('SF Ahorro USD', td_l), Paragraph('+7% (FX gain)', td_s), Paragraph('+7', td_s), Paragraph('107', td_s)],
    [Paragraph('<b>TOTAL</b>', td_l), Paragraph('<b>Mix</b>', td_s), Paragraph('<b>+12</b>', td_s), Paragraph('<b>2.012</b>', td_s)],
]
story.append(Spacer(1, 4))
story.append(make_table(esc_a_data, [aw*0.30, aw*0.24, aw*0.22, aw*0.24]))
story.append(Paragraph('Escenario Amarillo: USD 2.012 (+0,6%)', caption))

# ESCENARIO ROJO
story.append(Spacer(1, 8))
esc_r = [[Paragraph('<b>ESCENARIO ROJO - SHOCK MACRO (Probabilidad: 15%)</b>', ParagraphStyle('er', fontName=FNB, fontSize=10, leading=14, textColor=colors.white, alignment=TA_CENTER))]]
esc_r_tbl = Table(esc_r, colWidths=[aw], hAlign='CENTER')
esc_r_tbl.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,-1), RED_DARK), ('TOPPADDING', (0,0), (-1,-1), 6), ('BOTTOMPADDING', (0,0), (-1,-1), 6)]))
story.append(esc_r_tbl)

story.append(Paragraph(
    'Salto cambiario del 15-20%, inflacion rebota al 4-5% mensual, BCRA sube tasas 10-15 puntos. El '
    'componente USD es el unico refugio. Los bonos CER sufren mark-to-market severa (-3-5%) por duration '
    'pero se recuperarian a vencimiento. El money market pierde valor real aceleradamente. Este escenario '
    'es de baja probabilidad pero alto impacto.',
    body
))

esc_r_data = [
    [Paragraph('<b>Instrumento</b>', th_s), Paragraph('<b>Rend. 30d</b>', th_s), Paragraph('<b>Ganancia USD</b>', th_s), Paragraph('<b>USD Final</b>', th_s)],
    [Paragraph('Super Ahorro $', td_l), Paragraph('2,0% (real -3,5%)', td_s), Paragraph('-10', td_s), Paragraph('790', td_s)],
    [Paragraph('Supergestion Mix VI', td_l), Paragraph('-2,0% (mark-to-mkt)', td_s), Paragraph('-15', td_s), Paragraph('385', td_s)],
    [Paragraph('SF Renta Fija CER', td_l), Paragraph('-3,0% (MTM) + CER', td_s), Paragraph('-15', td_s), Paragraph('685', td_s)],
    [Paragraph('SF Ahorro USD', td_l), Paragraph('+17% (FX gain)', td_s), Paragraph('+17', td_s), Paragraph('117', td_s)],
    [Paragraph('<b>TOTAL</b>', td_l), Paragraph('<b>Mix</b>', td_s), Paragraph('<b>-23</b>', td_s), Paragraph('<b>1.977</b>', td_s)],
]
story.append(Spacer(1, 4))
story.append(make_table(esc_r_data, [aw*0.30, aw*0.24, aw*0.22, aw*0.24]))
story.append(Paragraph('Escenario Rojo: USD 1.977 (-1,15%)', caption))

story.append(Spacer(1, 10))

# Resumen escenarios
esc_sum = [
    [Paragraph('<b>Escenario</b>', th_s), Paragraph('<b>Prob.</b>', th_s),
     Paragraph('<b>USD Final</b>', th_s), Paragraph('<b>Ganancia USD</b>', th_s),
     Paragraph('<b>Ganancia %</b>', th_s)],
    [Paragraph('Verde - Estabilidad', td_l), Paragraph('60%', td_s),
     Paragraph('2.022,5', td_s), Paragraph('+22,5', td_s), Paragraph('+1,13%', td_s)],
    [Paragraph('Amarillo - Deval. leve', td_l), Paragraph('25%', td_s),
     Paragraph('2.012', td_s), Paragraph('+12', td_s), Paragraph('+0,60%', td_s)],
    [Paragraph('Rojo - Shock', td_l), Paragraph('15%', td_s),
     Paragraph('1.977', td_s), Paragraph('-23', td_s), Paragraph('-1,15%', td_s)],
    [Paragraph('<b>Esperanza matematica</b>', td_l), Paragraph('<b>100%</b>', td_s),
     Paragraph('<b>2.013</b>', td_s), Paragraph('<b>+13</b>', td_s), Paragraph('<b>+0,65%</b>', td_s)],
]
story.append(Spacer(1, 8))
story.append(make_table(esc_sum, [aw*0.26, aw*0.12, aw*0.22, aw*0.22, aw*0.18]))
story.append(Paragraph('Tabla 6: Resumen de escenarios - Impacto en valor final del portafolio', caption))

story.append(Spacer(1, 8))
story.append(green_box(
    '<b>Resultado esperado ponderado:</b> +USD 13 (+0,65% del capital) en 30 dias. Incluso en el peor '
    'escenario (shock macro, 15% de probabilidad), la perdida maxima es de -USD 23 (-1,15%), dentro del '
    'umbral de preservacion de capital. En el escenario base (60% probabilidad), la ganancia es de '
    '+USD 22,5 (+1,13%). El portafolio esta disenado para que el resultado ponderado sea positivo '
    'incluso considerando la cola de riesgo cambiario.'
))

story.append(Spacer(1, 14))

# ════════════════════════════════════════════════════════════════
# 8. SUPUESTOS Y DISCLAIMER
# ════════════════════════════════════════════════════════════════
story.append(hr())
story.append(Paragraph('<b>Supuestos Explicitos del Modelo</b>', h3))

supuestos = [
    'Tipo de cambio base: $1.460/USD (MEP y oficial a junio 2026)',
    'Inflacion mensual esperada: 2,1% (REM junio 2026)',
    'Devaluacion implicita 30 dias: ~1,0% (dentro de bandas)',
    'TNA Super Ahorro $: 25% (estimado sobre base diaria 0,07-0,14%)',
    'TNA Supergestion Mix VI: 27% (estimado sobre base diaria 0,11%)',
    'TNA Superfondo Renta Fija CER: 35% (incluye ajuste CER + spread real)',
    'TNA Superfondo Ahorro USD: ~4% anualizado en USD',
    'Plazo fijo Santander 30d: 15% TNA (confirmado junio 2026)',
    'No se incluyen costos de transaccion MEP ni comisiones de rescate FCI',
    'Se asume disponibilidad inmediata de cuotapartes para montos menores a ARS 1.500.000',
]

for s in supuestos:
    story.append(Paragraph(f'- {s}', ParagraphStyle('sup', fontName=FN, fontSize=9, leading=13, textColor=TEXT_MUTED, leftIndent=12, spaceBefore=1, spaceAfter=1)))

story.append(Spacer(1, 10))
story.append(Paragraph(
    '<b>Aviso Legal:</b> Este documento constituye un analisis tecnico de caracter informativo y no '
    'representa una recomendacion de inversion personalizada. Los datos provienen de fuentes publicas '
    '(BCRA, REM, CAFCI, FIX SCR, Santander Argentina) y son susceptibles de cambio. Los rendimientos '
    'pasados no garantizan resultados futuros. Las estimaciones de retorno real se basan en proyecciones '
    'que pueden no materializarse. El inversor debe evaluar su perfil de riesgo y situacion particular '
    'antes de tomar cualquier decision de inversion. Los rangos de retorno son estimaciones basadas en '
    'el escenario macro actual y podrian diferir significativamente del resultado real.',
    ParagraphStyle('disc', fontName=FN, fontSize=8, leading=11, textColor=TEXT_MUTED, alignment=TA_JUSTIFY)
))

# BUILD
doc.build(story)
print(f"PDF generated: {output_path}")

import os
sz = os.path.getsize(output_path)
from pypdf import PdfReader
r = PdfReader(output_path)
print(f"Pages: {len(r.pages)}, Size: {sz/1024:.1f} KB")
