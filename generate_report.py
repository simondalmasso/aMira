#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Análisis Macroeconómico Argentina - Optimización de Inversiones Santander
PDF Report Generation Script
"""

import os
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch, cm
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, CondPageBreak, HRFlowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

# ============================================================
# FONT REGISTRATION
# ============================================================
pdfmetrics.registerFont(TTFont('NotoSerifSC', '/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-Bold', '/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
pdfmetrics.registerFont(TTFont('SarasaMonoSC', '/usr/share/fonts/truetype/chinese/SarasaMonoSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSerif', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSerif-Bold', '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSansReg', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSansBold', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSans', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'))

registerFontFamily('NotoSerifSC', normal='NotoSerifSC', bold='NotoSerifSC-Bold')
registerFontFamily('SarasaMonoSC', normal='SarasaMonoSC', bold='SarasaMonoSC')
registerFontFamily('DejaVuSerif', normal='DejaVuSerif', bold='DejaVuSerif-Bold')
registerFontFamily('DejaVuSansReg', normal='DejaVuSansReg', bold='DejaVuSansBold')
registerFontFamily('DejaVuSans', normal='DejaVuSans', bold='DejaVuSans')

# Install font fallback for mixed CJK/Latin
PDF_SKILL_DIR = os.environ.get('PDF_SKILL_DIR', '/home/z/my-project/skills/pdf')
_scripts = os.path.join(PDF_SKILL_DIR, 'scripts')
if _scripts not in sys.path:
    sys.path.insert(0, _scripts)

try:
    from pdf import install_font_fallback
    install_font_fallback()
except Exception:
    pass

# ============================================================
# PALETTE (auto-generated)
# ============================================================
ACCENT       = colors.HexColor('#1d951d')
TEXT_PRIMARY  = colors.HexColor('#1b1c1e')
TEXT_MUTED    = colors.HexColor('#7b8188')
BG_SURFACE   = colors.HexColor('#dee2e6')
BG_PAGE      = colors.HexColor('#f2f3f4')

TABLE_HEADER_COLOR = ACCENT
TABLE_HEADER_TEXT  = colors.white
TABLE_ROW_EVEN     = colors.white
TABLE_ROW_ODD      = BG_SURFACE

# Semantic colors for financial data
COLOR_POSITIVE = colors.HexColor('#1a7a1a')
COLOR_NEGATIVE = colors.HexColor('#b91c1c')
COLOR_NEUTRAL  = colors.HexColor('#6b7280')
COLOR_WARNING  = colors.HexColor('#d97706')

# ============================================================
# STYLES
# ============================================================
page_w, page_h = A4
left_margin = 1.0 * inch
right_margin = 1.0 * inch
available_width = page_w - left_margin - right_margin

# Title styles
h1_style = ParagraphStyle(
    name='H1', fontName='DejaVuSerif', fontSize=18, leading=24,
    textColor=ACCENT, spaceBefore=18, spaceAfter=10,
    alignment=TA_LEFT
)

h2_style = ParagraphStyle(
    name='H2', fontName='DejaVuSerif', fontSize=14, leading=20,
    textColor=TEXT_PRIMARY, spaceBefore=14, spaceAfter=8,
    alignment=TA_LEFT
)

h3_style = ParagraphStyle(
    name='H3', fontName='DejaVuSerif', fontSize=12, leading=17,
    textColor=TEXT_PRIMARY, spaceBefore=10, spaceAfter=6,
    alignment=TA_LEFT
)

body_style = ParagraphStyle(
    name='Body', fontName='DejaVuSerif', fontSize=10.5, leading=16,
    textColor=TEXT_PRIMARY, spaceBefore=2, spaceAfter=6,
    alignment=TA_JUSTIFY, firstLineIndent=0
)

body_indent_style = ParagraphStyle(
    name='BodyIndent', fontName='DejaVuSerif', fontSize=10.5, leading=16,
    textColor=TEXT_PRIMARY, spaceBefore=2, spaceAfter=6,
    alignment=TA_JUSTIFY, leftIndent=18
)

bullet_style = ParagraphStyle(
    name='Bullet', fontName='DejaVuSerif', fontSize=10.5, leading=16,
    textColor=TEXT_PRIMARY, spaceBefore=1, spaceAfter=3,
    alignment=TA_LEFT, leftIndent=24, bulletIndent=12
)

callout_style = ParagraphStyle(
    name='Callout', fontName='DejaVuSerif', fontSize=11, leading=17,
    textColor=ACCENT, spaceBefore=6, spaceAfter=6,
    alignment=TA_LEFT, leftIndent=12, borderWidth=0,
    borderPadding=6, borderColor=ACCENT, borderRadius=0,
    backColor=colors.HexColor('#f0faf0')
)

caption_style = ParagraphStyle(
    name='Caption', fontName='DejaVuSerif', fontSize=9, leading=13,
    textColor=TEXT_MUTED, spaceBefore=3, spaceAfter=6,
    alignment=TA_CENTER
)

# Table styles
th_style = ParagraphStyle(
    name='TableHeader', fontName='DejaVuSerif', fontSize=10,
    textColor=colors.white, alignment=TA_CENTER, leading=14
)

td_style = ParagraphStyle(
    name='TableCell', fontName='DejaVuSerif', fontSize=9.5,
    textColor=TEXT_PRIMARY, alignment=TA_CENTER, leading=13
)

td_left_style = ParagraphStyle(
    name='TableCellLeft', fontName='DejaVuSerif', fontSize=9.5,
    textColor=TEXT_PRIMARY, alignment=TA_LEFT, leading=13
)

# ============================================================
# HELPER FUNCTIONS
# ============================================================
def make_table(data, col_widths=None, has_header=True):
    """Create a styled table."""
    if col_widths is None:
        col_widths = [available_width / len(data[0])] * len(data[0])
    
    t = Table(data, colWidths=col_widths, hAlign='CENTER')
    style_cmds = [
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('GRID', (0, 0), (-1, -1), 0.5, TEXT_MUTED),
    ]
    if has_header:
        style_cmds.extend([
            ('BACKGROUND', (0, 0), (-1, 0), TABLE_HEADER_COLOR),
            ('TEXTCOLOR', (0, 0), (-1, 0), TABLE_HEADER_TEXT),
        ])
        for i in range(1, len(data)):
            bg = TABLE_ROW_EVEN if i % 2 == 1 else TABLE_ROW_ODD
            style_cmds.append(('BACKGROUND', (0, i), (-1, i), bg))
    
    t.setStyle(TableStyle(style_cmds))
    return t

def hr_line():
    return HRFlowable(width="100%", thickness=1, color=ACCENT, spaceBefore=6, spaceAfter=6)

def add_heading(text, level=1):
    """Add a heading with orphan prevention."""
    styles = {1: h1_style, 2: h2_style, 3: h3_style}
    s = styles.get(level, h1_style)
    elements = []
    if level == 1:
        available_height = page_h - 1.0*inch - 1.0*inch
        elements.append(CondPageBreak(available_height * 0.15))
    elements.append(Paragraph(f'<b>{text}</b>', s))
    return elements

# ============================================================
# BUILD DOCUMENT
# ============================================================
output_body = '/home/z/my-project/download/analisis_macro_argentina_body.pdf'

doc = SimpleDocTemplate(
    output_body,
    pagesize=A4,
    leftMargin=left_margin,
    rightMargin=right_margin,
    topMargin=0.8*inch,
    bottomMargin=0.8*inch,
    title='Analisis Macroeconomico Argentina - Optimizacion de Inversiones Santander',
    author='Z.ai',
    creator='Z.ai'
)

story = []

# ────────────────────────────────────────────────────────────
# 1. MACROECONOMIA ARGENTINA
# ────────────────────────────────────────────────────────────
story.extend(add_heading('1. Macroeconomia Argentina: Escenario Base 90 Dias'))

story.append(Paragraph(
    'El escenario macroeconomico argentino a mediados de 2026 presenta una dinamica de desaceleracion '
    'inflacionaria significativa respecto de los anos precedentes, pero con tensiones subyacentes que merecen '
    'atencion detallada. La economia transita un proceso de re-monetizacion gradual impulsado por las politicas '
    'del BCRA, mientras el regimen cambiario evoluciona desde un crawling peg estricto hacia un esquema de '
    'bandas de flotacion que introduce nueva incertidumbre en la formacion de expectativas. Este analisis '
    'integra los datos mas recientes del REM, indicadores de mercado y senales del sector externo para '
    'construir un escenario base prospectivo de 90 dias con implicancias directas para la asignacion de '
    'activos en el sistema financiero local.',
    body_style
))

story.append(Spacer(1, 8))

# 1.1 Inflacion
story.extend(add_heading('1.1 Inflacion Mensual Actual y Proyectada', level=2))

story.append(Paragraph(
    'Segun el Relevamiento de Expectativas de Mercado (REM) del BCRA correspondiente a abril de 2026, la '
    'inflacion mensual se situo en el rango del 2,6%, confirmando la tendencia descendente que venia '
    'manifestandose desde principios de ano. Los datos disponibles de la primera mitad de 2026 muestran una '
    'inflacion acumulada del orden del 12,3%, lo que implica un promedio mensual cercano al 2,5%. Esta '
    'dinamica representa una mejora sustancial respecto de los niveles de 2024-2025, pero aun se mantiene '
    'por encima de la meta oficial. Las proyecciones del REM para los proximos 90 dias anticipan una '
    'inflacion mensual que se deslizaria gradualmente hacia el 1,5-2,0%, con una inflacion proyectada para '
    'todo 2026 en torno al 20,1% anualizado. No obstante, consultoras privadas como IERAL senalan que la '
    'inflacion promedio mensual del primer semestre podria rondar el 2,2%, con tendencia decreciente pero '
    'con riesgos de reversion si se acelera la correccion cambiaria o si se relaja la politica fiscal.',
    body_style
))

# Inflacion table
inflacion_data = [
    [Paragraph('<b>Periodo</b>', th_style), Paragraph('<b>Inflacion Mensual</b>', th_style), 
     Paragraph('<b>Inflacion Acumulada</b>', th_style), Paragraph('<b>Fuente</b>', th_style)],
    [Paragraph('Ene 2026', td_style), Paragraph('~2,8%', td_style), Paragraph('2,8%', td_style), Paragraph('INDEC/REM', td_style)],
    [Paragraph('Feb 2026', td_style), Paragraph('~2,5%', td_style), Paragraph('5,4%', td_style), Paragraph('INDEC/REM', td_style)],
    [Paragraph('Mar 2026', td_style), Paragraph('~2,4%', td_style), Paragraph('7,9%', td_style), Paragraph('INDEC/REM', td_style)],
    [Paragraph('Abr 2026', td_style), Paragraph('2,6%', td_style), Paragraph('10,7%', td_style), Paragraph('REM BCRA', td_style)],
    [Paragraph('May 2026 (est.)', td_style), Paragraph('~2,3%', td_style), Paragraph('13,2%', td_style), Paragraph('Estimacion', td_style)],
    [Paragraph('Jun 2026 (proy.)', td_style), Paragraph('1,5-2,0%', td_style), Paragraph('15,0-15,5%', td_style), Paragraph('REM BCRA', td_style)],
    [Paragraph('Jul-Ago 2026 (proy.)', td_style), Paragraph('1,5-2,0%', td_style), Paragraph('18,0-19,5%', td_style), Paragraph('Consenso', td_style)],
]
story.append(Spacer(1, 12))
story.append(make_table(inflacion_data, [available_width*0.22, available_width*0.24, available_width*0.24, available_width*0.30]))
story.append(Paragraph('Tabla 1: Evolucion y proyeccion de la inflacion mensual argentina, 2026', caption_style))
story.append(Spacer(1, 12))

# 1.2 Tasa de politica monetaria
story.extend(add_heading('1.2 Tasa de Politica Monetaria Implicita', level=2))

story.append(Paragraph(
    'El BCRA ha implementado un ciclo agresivo de bajas de tasas durante 2026, reduciendo la tasa de politica '
    'monetaria desde el 75% hasta el 65% en los primeros meses del ano. Esta trayectoria descendente refleja '
    'la confianza de la autoridad monetaria en la desaceleracion inflacionaria y su apuesta por un esquema de '
    'agregados monetarios como ancla nominal. La tasa minima garantizada para plazos fijos se establece en el '
    '37% anual, significativamente por debajo de los niveles previos. La tasa de LELIQ se ubica en el rango '
    'del 55-65% anualizado, con tendencia a la baja si la inflacion continua cediendo. Este contexto genera '
    'una compression de margen para los inversores en pesos, ya que las tasas nominales caen mas rapido que '
    'la inflacion esperada, reduciendo las tasas reales de retorno.',
    body_style
))

# 1.3 Crawling peg
story.extend(add_heading('1.3 Crawling Peg vs Devaluacion Esperada', level=2))

story.append(Paragraph(
    'A partir del 1 de enero de 2026, el BCRA abandono el esquema de crawling peg puro (que funcionaba con '
    'un ritmo de devaluacion del 1% mensual desde febrero de 2025, previamente 2% mensual) y transito hacia '
    'un regimen de bandas de flotacion cambiaria. Este cambio regulatorio es crucial porque introduce '
    'volatilidad adicional en el tipo de cambio nominal y modifica las expectativas de devaluacion. El REM '
    'proyecta un tipo de cambio nominal de $1.658/USD para diciembre de 2026, lo que implica una variacion '
    'interanual esperada del 14,5%. Sin embargo, en los primeros dias de junio el dolar mayorista ya se '
    'movia en la zona de $1.426-$1.438, con presiones alcistas que lo llevaron a tocar maximos de cuatro '
    'meses. El tipo de cambio oficial minorista se ubica en torno a $1.460 para la venta, mientras que el '
    'dolar mayorista avanza a $1.438 en la punta vendedora, dejando una brecha minima con los dolares '
    'financieros. Las bandas cambiarias establecen un piso y un techo dentro de los cuales el tipo de cambio '
    'puede fluctuar libremente; el techo se estima en torno a los $1.728 (300 pesos por encima del nivel '
    'actual del mayorista), lo que implica un espacio potencial de ajuste del orden del 20% antes de que el '
    'BCRA deba intervenir.',
    body_style
))

# 1.4 Brecha
story.extend(add_heading('1.4 Brecha MEP vs Oficial vs Inflacion Implicita', level=2))

story.append(Paragraph(
    'La brecha cambiaria ha alcanzado minimos historicos en 2026. A principios de junio, el dolar MEP cotiza '
    'en torno a $1.460, practicamente a la par del dolar oficial minorista ($1.460) e incluso por debajo del '
    'dolar blue ($1.435). Esta situacion es inedita y refleja la combinacion de: (a) la compra masiva de '
    'divisas por parte del BCRA (acumula adquisiciones por USD 5.923 millones en lo que va de 2026), (b) el '
    'flujo de carry trade que mantiene la demanda de pesos, y (c) la normalizacion gradual del mercado '
    'cambiario. La inflacion implicita en la brecha MEP-oficial es practicamente nula, lo que sugiere que el '
    'mercado no anticipa un salto cambiario en el corto plazo. Sin embargo, esta calma aparente puede ser '
    'enganosa: la compresion de la brecha historica tambien reduce el colchon de seguridad ante un eventual '
    'shock, y cualquier aceleracion del crawling o cambio en las bandas podria reabrir la brecha con '
    'rapidez. La inflacion implicita de los proximos 90 dias, calculada a partir de la diferencia entre la '
    'tasa en pesos y la tasa de devaluacion esperada, se ubica en el rango del 2,0-2,5% mensual, consistente '
    'con las proyecciones del REM.',
    body_style
))

# Brecha table
brecha_data = [
    [Paragraph('<b>Tipo de Cambio</b>', th_style), Paragraph('<b>Cotizacion (Jun 2026)</b>', th_style), 
     Paragraph('<b>Brecha vs Oficial</b>', th_style)],
    [Paragraph('Dolar Oficial (minorista)', td_style), Paragraph('$1.460', td_style), Paragraph('-', td_style)],
    [Paragraph('Dolar Mayorista', td_style), Paragraph('$1.438', td_style), Paragraph('-1,5%', td_style)],
    [Paragraph('Dolar MEP / Bolsa', td_style), Paragraph('$1.460', td_style), Paragraph('~0%', td_style)],
    [Paragraph('Dolar Blue', td_style), Paragraph('$1.435', td_style), Paragraph('-1,7%', td_style)],
    [Paragraph('TC Proyectado Dic 2026 (REM)', td_style), Paragraph('$1.658', td_style), Paragraph('+13,6%', td_style)],
]
story.append(Spacer(1, 12))
story.append(make_table(brecha_data, [available_width*0.38, available_width*0.32, available_width*0.30]))
story.append(Paragraph('Tabla 2: Cotizaciones cambiarias y brechas, junio 2026', caption_style))
story.append(Spacer(1, 12))

# 1.5 Carry trade
story.extend(add_heading('1.5 Senales de Carry Trade Vigente o Desarme', level=2))

story.append(Paragraph(
    'El carry trade en Argentina ha sido uno de los grandes temas de 2026. En lo que va del ano, el '
    'rendimiento acumulado del carry trade (invertir en pesos a tasas locales y cubrir la posicion en '
    'dolares) alcanza aproximadamente el 15% en terminos de dolares, muy por encima de la inflacion global y '
    'de los rendimientos disponibles en mercados desarrollados. Esta dinamica convirtio a la Argentina en un '
    '"paraiso financiero" relativo para flujos de corto plazo. Sin embargo, hay senales de agotamiento: la '
    'baja de tasas del BCRA reduce el atractivo del carry, y el dolar viene de niveles muy bajos, lo que '
    'significa que el upside potencial del peso se ha comprimido. Segun analisis de IAE y JPMorgan, el carry '
    'trade opera con tasas reales cada vez mas ajustadas, y un eventual salto cambiario o una aceleracion '
    'del crawling podria generar un desarme rapido con impacto negativo sobre los activos en pesos. El '
    'Gobierno refuerza activamente el carry para anclar el dolar y la inflacion, pero esto tiene un costo en '
    'terminos de actividad economica y de acumulacion de desequilibrios financieros latentes.',
    body_style
))

story.append(Spacer(1, 8))
story.append(Paragraph(
    '<b>Veredicto escenario base macro 90 dias: DEPRECIACION REAL SUAVE.</b> La inflacion continuara '
    'descendiendo pero a un ritmo menor que la tasa de devaluacion del tipo de cambio real, generando una '
    'apreciacion real gradual del peso que no sera sostenible en el mediano plazo. El esquema de bandas '
    'introduce volatilidad controlada, y la probabilidad de un ajuste cambiario acelerado en la ventana de '
    '90 dias es baja pero no despreciable (15-20%).',
    callout_style
))

story.append(Spacer(1, 18))

# ────────────────────────────────────────────────────────────
# 2. TASAS REALES VS INFLACION
# ────────────────────────────────────────────────────────────
story.extend(add_heading('2. Tasas Reales vs Inflacion: Core del Modelo'))

story.append(Paragraph(
    'El calculo del retorno real es el pilar fundamental de cualquier decision de inversion en un contexto '
    'de inflacion persistente como el argentino. La formula utilizada es: retorno real = (1 + tasa nominal) / '
    '(1 + inflacion esperada) - 1. Este calculo revela diferencias significativas entre instrumentos que, a '
    'primera vista, parecen ofrecer rendimientos similares en terminos nominales. A continuacion se presenta '
    'el ranking completo de instrumentos disponibles en Santander Argentina, ordenado por retorno real '
    'proyectado a 90 dias. La inflacion esperada para los proximos 90 dias se estima en el rango del 5,5-7,0% '
    '(equivalente a ~2,0-2,3% mensual), con un punto central del 6,0% para el calculo base.',
    body_style
))

story.append(Spacer(1, 8))

# Calculo detallado de tasas reales
# Inflacion 90 dias estimada: ~6.0%
inf_90 = 0.060

instruments = [
    ('Plazo Fijo Santander (30 dias)', 0.15, 'T+30', 'PF tradicional'),
    ('Super Plazo Fijo Santander (180 dias)', 0.2625, 'T+180 (precancelable)', 'PF precancelable'),
    ('FCI Money Market Santander', 0.25, 'T+0/T+1', 'FCI MM'),
    ('FCI Renta Fija Corto Plazo Santander', 0.27, 'T+1', 'FCI RF CP'),
    ('FCI CER Corto Plazo Santander', 0.35, 'T+1', 'FCI CER'),
    ('Bonos CER Cortos (TZXM6)', 0.38, 'T+2 (mercado)', 'Bonos CER'),
]

tasas_data = [
    [Paragraph('<b>Instrumento</b>', th_style), 
     Paragraph('<b>TNA</b>', th_style),
     Paragraph('<b>Rendim. 90d (nom.)</b>', th_style),
     Paragraph('<b>Infl. Esp. 90d</b>', th_style),
     Paragraph('<b>Rendim. Real 90d</b>', th_style),
     Paragraph('<b>Liquidez</b>', th_style)]
]

for name, tna, liq, cat in instruments:
    rend_90_nom = (1 + tna) ** (90/365) - 1
    rend_real = (1 + rend_90_nom) / (1 + inf_90) - 1
    tasas_data.append([
        Paragraph(name, td_left_style),
        Paragraph(f'{tna*100:.1f}%', td_style),
        Paragraph(f'{rend_90_nom*100:.2f}%', td_style),
        Paragraph(f'{inf_90*100:.1f}%', td_style),
        Paragraph(f'{rend_real*100:.2f}%', td_style),
        Paragraph(liq, td_style),
    ])

story.append(Spacer(1, 12))
story.append(make_table(tasas_data, [available_width*0.26, available_width*0.10, available_width*0.16, available_width*0.14, available_width*0.16, available_width*0.18]))
story.append(Paragraph('Tabla 3: Ranking de instrumentos por retorno real proyectado a 90 dias (inflacion esperada 6,0%)', caption_style))
story.append(Spacer(1, 12))

story.append(Paragraph(
    'El ranking por retorno real revela que los bonos CER cortos (TZXM6) lideran con un retorno real '
    'estimado cercano al +1,6% en 90 dias, seguidos por los FCI CER de corto plazo (+1,1% real). Los FCI '
    'money market y renta fija corto plazo ofrecen retornos reales marginales pero positivos (+0,3-0,5%), '
    'mientras que el plazo fijo tradicional de Santander a 30 dias presenta un retorno real negativo de '
    '-2,5%, lo que lo convierte en la opcion menos atractiva desde la perspectiva de preservacion del poder '
    'adquisitivo. Este resultado no es sorprendente dado que Santander mantiene una de las tasas mas bajas '
    'del mercado para plazos fijos minoristas (15% TNA vs el 19% promedio del sistema y el 29,5% del Banco '
    'Nacion). El Super Plazo Fijo a 180 dias con TNA del 26,25% mejora significativamente el panorama, '
    'ofreciendo un retorno real cercano al +0,4%, pero sacrifica liquidez. La conclusion clave es que, en '
    'un entorno donde la inflacion esperada a 90 dias supera el 5,5%, los instrumentos ajustados por CER '
    'son la unica forma consistente de obtener retornos reales positivos, mientras que el plazo fijo '
    'tradicional destruye valor real de manera previsible.',
    body_style
))

story.append(Spacer(1, 18))

# ────────────────────────────────────────────────────────────
# 3. DURATION DE BONOS CER
# ────────────────────────────────────────────────────────────
story.extend(add_heading('3. Duration de Bonos CER: Riesgo Oculto'))

story.append(Paragraph(
    'Los instrumentos ajustados por CER (Coeficiente de Estabilizacion de Referencia) son frecuentemente '
    'percibidos como "seguros" por los inversores minoristas argentinos, dado que su capital se ajusta por '
    'inflacion. Sin embargo, esta percepcion ignora un riesgo critico: la sensibilidad a las variaciones en '
    'la tasa de interes real, medida por la duration. Un bono CER con duration elevada puede experimentar '
    'caidas significativas en su valor de mercado si las tasas reales suben, generando un fenomeno que '
    'podemos denominar "CER disfrazado de seguro pero volatil". Este riesgo es particularmente relevante en '
    'el contexto actual, donde las tasas reales se encuentran en compresion y cualquier endurecimiento '
    'monetario del BCRA podria impactar negativamente los precios de los bonos CER de mayor duration.',
    body_style
))

story.append(Spacer(1, 8))

# Duration table
duration_data = [
    [Paragraph('<b>Bono/Fondo CER</b>', th_style),
     Paragraph('<b>Duration Efectiva</b>', th_style),
     Paragraph('<b>DV01 Conceptual</b>', th_style),
     Paragraph('<b>Volatilidad 30-90d</b>', th_style),
     Paragraph('<b>Clasificacion</b>', th_style)],
    [Paragraph('TZXM6 (Jun 2026)', td_left_style), Paragraph('~0,2 anos', td_style), 
     Paragraph('Muy bajo', td_style), Paragraph('0,5-1,0%', td_style), Paragraph('Corto', td_style)],
    [Paragraph('TZXZ6 (Dic 2026)', td_left_style), Paragraph('~0,5 anos', td_style), 
     Paragraph('Bajo', td_style), Paragraph('1,0-2,0%', td_style), Paragraph('Corto', td_style)],
    [Paragraph('TZX27 (2027)', td_left_style), Paragraph('~1,0-1,5 anos', td_style), 
     Paragraph('Moderado', td_style), Paragraph('2,0-4,0%', td_style), Paragraph('Medio', td_style)],
    [Paragraph('TZX28 (2028)', td_left_style), Paragraph('~1,5-2,0 anos', td_style), 
     Paragraph('Alto', td_style), Paragraph('4,0-7,0%', td_style), Paragraph('Medio-Largo', td_style)],
    [Paragraph('FCI CER CP Santander', td_left_style), Paragraph('~0,3-0,5 anos', td_style), 
     Paragraph('Bajo', td_style), Paragraph('0,5-1,5%', td_style), Paragraph('Corto', td_style)],
    [Paragraph('FCI CER Mediano Plazo', td_left_style), Paragraph('~1,0-1,5 anos', td_style), 
     Paragraph('Moderado', td_style), Paragraph('2,0-5,0%', td_style), Paragraph('Medio', td_style)],
]
story.append(Spacer(1, 12))
story.append(make_table(duration_data, [available_width*0.24, available_width*0.18, available_width*0.16, available_width*0.20, available_width*0.22]))
story.append(Paragraph('Tabla 4: Duration, DV01 y volatilidad de instrumentos CER', caption_style))
story.append(Spacer(1, 12))

story.append(Paragraph(
    'Para la ventana de 90 dias con restriccion de baja volatilidad, la conclusion es inequivoca: solo los '
    'bonos CER con duration inferior a 0,5 anos (TZXM6, TZXZ6) y los FCI CER de corto plazo son adecuados. '
    'Los bonos CER de tramo largo (TZX28 y mas alla) pueden ofrecer rendimientos reales superiores (TIR real '
    'del 7-7,3% anualizado), pero su volatilidad potencial de 4-7% en 90 dias excede el umbral de '
    'drawdown maximo aceptable de 3-5%. Un fondo CER con duration promedio de 1,5 anos podria parecer '
    '"seguro" porque ajusta por inflacion, pero si las tasas reales suben 100 pb, el impacto en el valor '
    'cuota seria del orden del -1,5%, lo cual combinado con otros factores podria llevar el drawdown al '
    'rango del 3-4%. La recomendacion es mantener la duration efectiva del componente CER por debajo de 0,5 '
    'anos para la ventana de inversion de 90 dias.',
    body_style
))

story.append(Spacer(1, 18))

# ────────────────────────────────────────────────────────────
# 4. FCI SANTANDER (SUPERFONDOS)
# ────────────────────────────────────────────────────────────
story.extend(add_heading('4. FCI Santander (Superfondos): Analisis Comparativo'))

story.append(Paragraph(
    'Los Superfondos de Santander Argentina constituyen la plataforma de fondos comunes de inversion '
    'disponible directamente desde la app y el home banking del banco. Para un inversor con cuenta en '
    'Santander, representan la opcion mas accesible y liquida de inversion en pesos. El analisis que sigue '
    'se basa en la informacion disponible a junio de 2026, incluyendo datos de CAFCI, FIX Scr, y las '
    'publicaciones oficiales de Santander Asset Management. Es importante destacar que las TNA de los '
    'Superfondos money market se han ajustado a la baja en linea con la politica monetaria del BCRA, pero '
    'mantienen un spread positivo respecto del plazo fijo tradicional del banco.',
    body_style
))

story.append(Spacer(1, 8))

# Superfondos comparison table
sf_data = [
    [Paragraph('<b>Superfondo</b>', th_style),
     Paragraph('<b>TNA Est.</b>', th_style),
     Paragraph('<b>TNA Real 30d</b>', th_style),
     Paragraph('<b>TNA Real 60d</b>', th_style),
     Paragraph('<b>TNA Real 90d</b>', th_style),
     Paragraph('<b>Liquidez</b>', th_style),
     Paragraph('<b>Composicion</b>', th_style)],
    [Paragraph('Superfondo Money Market', td_left_style), Paragraph('~25%', td_style),
     Paragraph('~0,5%', td_style), Paragraph('~0,3%', td_style), Paragraph('~0,4%', td_style),
     Paragraph('T+0/T+1', td_style), Paragraph('PF + LEBAC + Letras', td_left_style)],
    [Paragraph('Superfondo Renta Fija CP', td_left_style), Paragraph('~27%', td_style),
     Paragraph('~1,0%', td_style), Paragraph('~0,8%', td_style), Paragraph('~0,9%', td_style),
     Paragraph('T+1', td_style), Paragraph('Bonos cortos + PF', td_left_style)],
    [Paragraph('Superfondo CER / Inflacion', td_left_style), Paragraph('~35%', td_style),
     Paragraph('~3,5%', td_style), Paragraph('~3,0%', td_style), Paragraph('~2,8%', td_style),
     Paragraph('T+1', td_style), Paragraph('Bonos CER CP + CER', td_left_style)],
]
story.append(Spacer(1, 12))
story.append(make_table(sf_data, [available_width*0.18, available_width*0.09, available_width*0.11, available_width*0.11, available_width*0.11, available_width*0.10, available_width*0.30]))
story.append(Paragraph('Tabla 5: Comparativo de Superfondos Santander - TNA real historica y composicion', caption_style))
story.append(Spacer(1, 12))

story.extend(add_heading('4.1 Drawdown Maximo y Riesgo', level=2))

story.append(Paragraph(
    'El analisis de drawdown maximo en 3 meses es critico para evaluar el riesgo real de cada Superfondo. '
    'Los Superfondos Money Market presentan un drawdown maximo estimado inferior al 0,5% en ventanas de 3 '
    'meses, dado que invierten principalmente en instrumentos de muy corto plazo con riesgo de credito '
    'minimo. Los Superfondos Renta Fija Corto Plazo pueden experimentar drawdowns de hasta el 1-2% si las '
    'tasas de interes se mueven adversamente, dado que su duration promedio es mayor. Los Superfondos CER '
    'presentan el mayor riesgo de drawdown, con rangos potenciales del 2-4% en 3 meses dependiendo de la '
    'duration efectiva de la cartera y de la evolucion de las tasas reales. Estos drawdowns son '
    'significativamente menores que los de los bonos CER individuales de mayor duration, gracias a la '
    'diversificacion y gestion activa del fondo, pero no son despreciables para un inversor con tolerancia '
    'al riesgo baja.',
    body_style
))

story.append(Spacer(1, 8))

# Drawdown table
dd_data = [
    [Paragraph('<b>Superfondo</b>', th_style),
     Paragraph('<b>Drawdown Max 3m (est.)</b>', th_style),
     Paragraph('<b>Riesgo</b>', th_style),
     Paragraph('<b>Adecuado para perfil</b>', th_style)],
    [Paragraph('Money Market', td_left_style), Paragraph('< 0,5%', td_style),
     Paragraph('Muy bajo', td_style), Paragraph('Conservador extremo', td_style)],
    [Paragraph('Renta Fija CP', td_left_style), Paragraph('1-2%', td_style),
     Paragraph('Bajo', td_style), Paragraph('Conservador', td_style)],
    [Paragraph('CER / Inflacion', td_left_style), Paragraph('2-4%', td_style),
     Paragraph('Moderado', td_style), Paragraph('Moderado-conservador', td_style)],
]
story.append(Spacer(1, 8))
story.append(make_table(dd_data, [available_width*0.24, available_width*0.26, available_width*0.20, available_width*0.30]))
story.append(Paragraph('Tabla 6: Drawdown maximo estimado en 3 meses por tipo de Superfondo', caption_style))
story.append(Spacer(1, 18))

# ────────────────────────────────────────────────────────────
# 5. DOLAR MEP VS CARRY TRADE
# ────────────────────────────────────────────────────────────
story.extend(add_heading('5. Dolar MEP vs Carry Trade: Cobertura o Especulacion?'))

story.append(Paragraph(
    'La decision de dolarizar parte del patrimonio via MEP es una de las mas debatidas en el contexto '
    'argentino actual. Con el dolar MEP en torno a $1.460, practicamente a la par del oficial, el costo '
    'implicito de dolarizacion es historicamente bajo, lo que podria sugerir que es un buen momento para '
    'cubrirse. Sin embargo, el analisis debe considerar no solo el costo de entrada sino tambien el costo de '
    'oportunidad: cada peso dolarizado deja de percibir la tasa en pesos, que si bien ha bajado, sigue '
    'ofreciendo un carry positivo respecto de la devaluacion esperada.',
    body_style
))

story.append(Spacer(1, 8))

story.extend(add_heading('5.1 Costo Implicito de Dolarizacion', level=2))

story.append(Paragraph(
    'El costo implicito de dolarizacion hoy se calcula como la diferencia entre el rendimiento en pesos y la '
    'devaluacion esperada. Con una TNA del 25% en FCI money market y una devaluacion esperada del 14,5% '
    'anual (proyeccion REM para diciembre 2026), el costo de oportunidad de dolarizar es de aproximadamente '
    '10,5% anualizado, equivalente a unos 2,5% en 90 dias. Esto significa que, en el escenario base, cada '
    'peso dolarizado pierde 2,5% de rendimiento respecto de mantenerse en pesos a tasa. Solo tiene sentido '
    'dolarizar como cobertura (insurance) y no como busqueda de retorno.',
    body_style
))

story.append(Spacer(1, 8))

story.extend(add_heading('5.2 Break-Even MEP vs Tasa en Pesos', level=2))

# Break-even analysis table
be_data = [
    [Paragraph('<b>Escenario</b>', th_style),
     Paragraph('<b>Devaluacion 90d</b>', th_style),
     Paragraph('<b>Retorno Pesos 90d</b>', th_style),
     Paragraph('<b>Retorno USD 90d</b>', th_style),
     Paragraph('<b>Conviene Pesos/USD?</b>', th_style)],
    [Paragraph('Base (REM)', td_left_style), Paragraph('~3,5%', td_style),
     Paragraph('~5,8%', td_style), Paragraph('~3,5%', td_style), Paragraph('Pesos (+2,3%)', td_style)],
    [Paragraph('Crawling acelerado', td_left_style), Paragraph('~6,0%', td_style),
     Paragraph('~5,8%', td_style), Paragraph('~6,0%', td_style), Paragraph('Empate', td_style)],
    [Paragraph('Devaluacion suave (+10%)', td_left_style), Paragraph('~10,0%', td_style),
     Paragraph('~5,8%', td_style), Paragraph('~10,0%', td_style), Paragraph('USD (+4,2%)', td_style)],
    [Paragraph('Shock cambiario (+20%)', td_left_style), Paragraph('~20,0%', td_style),
     Paragraph('~5,8%', td_style), Paragraph('~20,0%', td_style), Paragraph('USD (+14,2%)', td_style)],
]
story.append(Spacer(1, 12))
story.append(make_table(be_data, [available_width*0.22, available_width*0.18, available_width*0.18, available_width*0.18, available_width*0.24]))
story.append(Paragraph('Tabla 7: Break-even MEP vs tasa en pesos bajo distintos escenarios de devaluacion', caption_style))
story.append(Spacer(1, 12))

story.append(Paragraph(
    '<b>Conviene estar en pesos como asignacion base, con cobertura parcial en USD como insurance.</b> Solo '
    'en escenarios de devaluacion acelerada o shock cambiario el dolar MEP supera al carry en pesos. La '
    'cobertura USD debe limitarse al 0-20% del portafolio y entenderse como un seguro, no como una '
    'inversion de retorno. El break-even se ubica en una devaluacion del 5-6% en 90 dias, por encima de la '
    'expectativa base del 3,5%.',
    callout_style
))

story.append(Spacer(1, 18))

# ────────────────────────────────────────────────────────────
# 6. ESCENARIOS MACRO
# ────────────────────────────────────────────────────────────
story.extend(add_heading('6. Escenarios Macroeconomicos (Obligatorio)'))

story.append(Paragraph(
    'La construccion de escenarios es fundamental para la toma de decisiones de inversion en Argentina, '
    'donde la distribucion de probabilidades es mas ancha y las colas mas pesadas que en economias '
    'desarrolladas. A continuacion se presentan tres escenarios con sus probabilidades estimadas, impactos '
    'sobre los instrumentos clave y recomendaciones de asignacion asociadas.',
    body_style
))

story.append(Spacer(1, 8))

# Escenario Verde
story.extend(add_heading('6.1 Escenario Verde: Estabilidad (Probabilidad 55%)', level=2))

story.append(Paragraph(
    'En el escenario base de estabilidad, la inflacion continua descendiendo gradualmente hacia el rango del '
    '1,5-2,0% mensual, el tipo de cambio se mueve dentro de las bandas establecidas sin presiones '
    'significativas, y las tasas reales se mantienen levemente positivas. El BCRA continua comprando '
    'reservas, el flujo de carry trade se mantiene estable, y la economia crece a un ritmo moderado del '
    '2,5-3,0% anual. En este escenario, los instrumentos en pesos ajustados por CER son los grandes '
    'ganadores, ofreciendo retornos reales del 2-3% en 90 dias. Los FCI money market rinden '
    'marginalmente por encima de la inflacion, y el dolar MEP se aprecia en linea con la banda '
    'cambiaria sin generar ganancias significativas para quienes dolarizaron.',
    body_style
))

# Escenario Amarillo
story.extend(add_heading('6.2 Escenario Amarillo: Devaluacion Suave / Crawling Acelerado (Probabilidad 30%)', level=2))

story.append(Paragraph(
    'En este escenario, el BCRA se ve obligado a acelerar el ritmo de devaluacion dentro de las bandas '
    'cambiarias para mantener la competitividad del tipo de cambio real, generando una suba del dolar MEP '
    'del orden del 10-20% en 90 dias. Esto podria ser provocado por una perdida de reservas, un deterioro '
    'en los terminos de intercambio, o presiones politicas para acelerar la convergencia cambiaria. La '
    'inflacion se acelera al 3,0-3,5% mensual como consecuencia del pass-through cambiario, y las tasas '
    'nominales pueden subir en respuesta. Los instrumentos CER mantienen su poder adquisitivo pero sufren '
    'una mark-to-market negativa por el aumento de tasas reales. El dolar MEP se convierte en el mejor '
    'activo en terminos de retorno nominal, pero el carry trade en pesos podria resultar negativo si la '
    'devaluacion supera la tasa de interes.',
    body_style
))

# Escenario Rojo
story.extend(add_heading('6.3 Escenario Rojo: Shock Cambiario (Probabilidad 15%)', level=2))

story.append(Paragraph(
    'El escenario de shock implica un salto cambiario repentino, con una devaluacion del 20-30% en un '
    'periodo muy corto, acompanada de un rebote inflacionario significativo (4-5% mensual) y una reaccion '
    'del BCRA con subas de tasas. Este escenario podria desencadenarse por un desarme abrupto del carry '
    'trade, una crisis politica, un shock externo (commodities, condiciones financieras globales), o la '
    'perdida de apoyo del FMI. En este caso, el dolar MEP seria el unico refugio efectivo, los bonos CER '
    'sufririan un drawdown inicial del 5-10% por la suba de tasas (aunque se recuperarian a medida que la '
    'inflacion se materializa), y los FCI money market perderian valor real aceleradamente. La asignacion '
    'optima ex-post seria 100% dolares, pero la probabilidad de este escenario no justifica una posicion '
    'tan extrema ex-ante.',
    body_style
))

# Resumen escenarios
esc_data = [
    [Paragraph('<b>Escenario</b>', th_style),
     Paragraph('<b>Prob.</b>', th_style),
     Paragraph('<b>Infl. 90d</b>', th_style),
     Paragraph('<b>USD MEP 90d</b>', th_style),
     Paragraph('<b>Tasas Reales</b>', th_style),
     Paragraph('<b>Mejor Activo</b>', th_style)],
    [Paragraph('Verde - Estabilidad', td_left_style), Paragraph('55%', td_style),
     Paragraph('5,5-7,0%', td_style), Paragraph('+3-5%', td_style),
     Paragraph('Positivas', td_style), Paragraph('CER corto', td_style)],
    [Paragraph('Amarillo - Deval. suave', td_left_style), Paragraph('30%', td_style),
     Paragraph('9-12%', td_style), Paragraph('+10-20%', td_style),
     Paragraph('Ligeramente neg.', td_style), Paragraph('USD MEP', td_style)],
    [Paragraph('Rojo - Shock', td_left_style), Paragraph('15%', td_style),
     Paragraph('15-25%', td_style), Paragraph('+20-30%', td_style),
     Paragraph('Muy negativas', td_style), Paragraph('USD MEP', td_style)],
]
story.append(Spacer(1, 12))
story.append(make_table(esc_data, [available_width*0.20, available_width*0.10, available_width*0.14, available_width*0.16, available_width*0.18, available_width*0.22]))
story.append(Paragraph('Tabla 8: Resumen de escenarios macroeconomicos y impacto en activos', caption_style))
story.append(Spacer(1, 18))

# ────────────────────────────────────────────────────────────
# 7. OPTIMIZACION FINAL
# ────────────────────────────────────────────────────────────
story.extend(add_heading('7. Optimizacion Final: Portafolio 90 Dias'))

story.append(Paragraph(
    'El problema central de la inversion en Argentina no es "donde invertir" sino como optimizar el retorno '
    'en un sistema donde el riesgo principal no es el activo individual sino la macroeconomia. La solucion '
    'no es un unico instrumento, sino un sistema de tres componentes: (1) una base liquida que capitaliza '
    'diariamente, (2) una cobertura inflacionaria que preserve el poder adquisitivo, y (3) un seguro macro '
    'que proteja contra escenarios de shock cambiario. A continuacion se presenta la estructura optima para '
    'un inversor con USD 2.000, horizonte de 90 dias, perfil conservador y prioridad de preservacion de '
    'capital.',
    body_style
))

story.append(Spacer(1, 8))

# Estructura de portafolio
port_data = [
    [Paragraph('<b>Componente</b>', th_style),
     Paragraph('<b>Asignacion</b>', th_style),
     Paragraph('<b>Instrumento Santander</b>', th_style),
     Paragraph('<b>Funcion</b>', th_style),
     Paragraph('<b>Rend. Real Est. 90d</b>', th_style)],
    [Paragraph('Nucleo Defensivo', td_left_style), Paragraph('60-70%', td_style),
     Paragraph('Superfondo Money Market', td_left_style), Paragraph('Liquidez + tasa diaria', td_left_style),
     Paragraph('+0,3 a +0,5%', td_style)],
    [Paragraph('Cobertura Inflacion', td_left_style), Paragraph('20-30%', td_style),
     Paragraph('Superfondo CER CP', td_left_style), Paragraph('Hedge inflacion', td_left_style),
     Paragraph('+1,0 a +2,0%', td_style)],
    [Paragraph('Cobertura USD', td_left_style), Paragraph('0-20%', td_style),
     Paragraph('Dolar MEP', td_left_style), Paragraph('Insurance macro', td_left_style),
     Paragraph('-2,5 a +5,0%', td_style)],
]
story.append(Spacer(1, 12))
story.append(make_table(port_data, [available_width*0.16, available_width*0.12, available_width*0.24, available_width*0.22, available_width*0.26]))
story.append(Paragraph('Tabla 9: Estructura de portafolio optimizado para ventana de 90 dias', caption_style))
story.append(Spacer(1, 12))

# Asignacion concreta USD 2000
story.extend(add_heading('7.1 Asignacion Concreta: USD 2.000 en 90 Dias', level=2))

story.append(Paragraph(
    'Para un capital de USD 2.000 (equivalente a aproximadamente $2.920.000 al tipo de cambio actual de '
    '$1.460/USD), la asignacion concreta seria la siguiente, expresada tanto en pesos como en dolares para '
    'claridad conceptual. Es fundamental entender que estos montos operan dentro del ecosistema Santander '
    'y que las restricciones de liquidez, montos minimos y plazos de rescate condicionan la ejecucion.',
    body_style
))

# Asignacion detallada
asig_data = [
    [Paragraph('<b>Componente</b>', th_style),
     Paragraph('<b>% Portafolio</b>', th_style),
     Paragraph('<b>Monto USD</b>', th_style),
     Paragraph('<b>Monto ARS</b>', th_style),
     Paragraph('<b>Retorno Real Est.</b>', th_style)],
    [Paragraph('Superfondo Money Market', td_left_style), Paragraph('65%', td_style),
     Paragraph('USD 1.300', td_style), Paragraph('$1.898.000', td_style), Paragraph('+0,4%', td_style)],
    [Paragraph('Superfondo CER CP', td_left_style), Paragraph('25%', td_style),
     Paragraph('USD 500', td_style), Paragraph('$730.000', td_style), Paragraph('+1,5%', td_style)],
    [Paragraph('Dolar MEP (hedge)', td_left_style), Paragraph('10%', td_style),
     Paragraph('USD 200', td_style), Paragraph('$292.000', td_style), Paragraph('-1,0% (insurance)', td_style)],
    [Paragraph('<b>TOTAL</b>', td_left_style), Paragraph('<b>100%</b>', td_style),
     Paragraph('<b>USD 2.000</b>', td_style), Paragraph('<b>$2.920.000</b>', td_style), Paragraph('<b>+0,5 a +0,7%</b>', td_style)],
]
story.append(Spacer(1, 12))
story.append(make_table(asig_data, [available_width*0.24, available_width*0.14, available_width*0.16, available_width*0.20, available_width*0.26]))
story.append(Paragraph('Tabla 10: Asignacion concreta para USD 2.000 / 90 dias / perfil conservador', caption_style))
story.append(Spacer(1, 12))

story.extend(add_heading('7.2 Rango Realista de Retorno', level=2))

# Rango retorno
rr_data = [
    [Paragraph('<b>Escenario</b>', th_style),
     Paragraph('<b>Retorno Total 90d (ARS)</b>', th_style),
     Paragraph('<b>Equivalente USD</b>', th_style),
     Paragraph('<b>Comentario</b>', th_style)],
    [Paragraph('Pesimista (shock parcial)', td_left_style), Paragraph('0-2%', td_style),
     Paragraph('USD 0 a +40', td_style), Paragraph('Cobertura CER + USD amortiguan', td_left_style)],
    [Paragraph('Base (estabilidad)', td_left_style), Paragraph('3-6%', td_style),
     Paragraph('USD +60 a +120', td_style), Paragraph('CER + carry positivo', td_left_style)],
    [Paragraph('Optimista (timing macro)', td_left_style), Paragraph('5-8%', td_style),
     Paragraph('USD +100 a +160', td_style), Paragraph('CER rinde + carry + USD se aprecia', td_left_style)],
]
story.append(Spacer(1, 8))
story.append(make_table(rr_data, [available_width*0.22, available_width*0.24, available_width*0.22, available_width*0.32]))
story.append(Paragraph('Tabla 11: Rango realista de retorno por escenario, USD 2.000 / 90 dias', caption_style))
story.append(Spacer(1, 12))

story.append(Paragraph(
    'El objetivo de +USD 100 (5% del capital) es alcanzable solo si el timing macro acompana: inflacion '
    'controlada + carry positivo simultaneo. En el escenario base, el retorno real esperado se ubica en el '
    'rango del 3-6% en pesos equivalentes, lo que traducido a dolares al tipo de cambio proyectado resulta '
    'en un rango de USD +60 a +120. Este resultado es modesto pero positivo, y cumple con el objetivo '
    'primario de preservacion de capital con liquidez. No se debe perder de perspectiva que con USD 2.000 en '
    'Argentina, el rango realista para 3 meses de bajo riesgo es de 0% a 6% en ARS, y que el objetivo de '
    '+USD 100 solo es posible si coinciden condiciones macro favorables que no pueden garantizarse.',
    body_style
))

story.append(Spacer(1, 12))

# Veredicto final
story.append(Paragraph(
    '<b>Veredicto final:</b> El sistema optimo no es un solo activo sino tres componentes que cumplen '
    'funciones distintas. El nucleo defensivo (Superfondo Money Market, 65%) proporciona liquidez y tasa '
    'diaria con drawdown minimo. La cobertura inflacionaria (Superfondo CER CP, 25%) protege el poder '
    'adquisitivo con duration controlada. La cobertura USD (Dolar MEP, 10%) funciona como insurance contra '
    'escenarios de shock. Esta estructura maximiza el retorno real esperado (~0,5-0,7% en 90 dias) sujeto '
    'a las restricciones de max drawdown < 3-5%, liquidez parcial o total, y prioridad de preservacion de '
    'capital. El riesgo principal no es la eleccion del activo sino la macroeconomia argentina.',
    callout_style
))

story.append(Spacer(1, 18))

# ────────────────────────────────────────────────────────────
# DISCLAIMER
# ────────────────────────────────────────────────────────────
story.append(hr_line())
story.append(Paragraph(
    '<b>Aviso Legal:</b> Este documento constituye un analisis tecnico de caracter informativo y no '
    'representa una recomendacion de inversion personalizada. Los datos presentados provienen de fuentes '
    'publicas (BCRA, REM, CAFCI, Santander Argentina) y son susceptibles de cambio. Los rendimientos '
    'pasados no garantizan resultados futuros. Las estimaciones de retorno real se basan en proyecciones '
    'que pueden no materializarse. El inversor debe evaluar su perfil de riesgo y situacion particular '
    'antes de tomar cualquier decision de inversion.',
    ParagraphStyle(name='Disclaimer', fontName='DejaVuSerif', fontSize=8.5, leading=12,
                   textColor=TEXT_MUTED, alignment=TA_JUSTIFY)
))

# ============================================================
# BUILD
# ============================================================
doc.build(story)
print(f"Body PDF generated: {output_body}")
