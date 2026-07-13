// ============================================================================
// ORÁCULO REBALANCE — Recomendaciones automáticas por régimen
// Genera sugerencias de rebalance basadas en régimen macro + objetivo retorno
// NO modifica portfolio directamente — solo sugiere
// ============================================================================

import { type MacroRegime, type OracleState, type ReturnTargetMode, REGIME_LABELS, RETURN_TARGETS } from './macroOracle';
import { type PortfolioAllocation, type PortfolioMetrics } from './portfolio-engine';

// ============================================================================
// TYPES
// ============================================================================
export type RebalanceAction = 'AUMENTAR' | 'REDUCIR' | 'CUBRIR' | 'MANTENER' | 'ROTAR';

export interface RebalanceRecommendation {
  action: RebalanceAction;
  target: string;           // categoría de producto o activo específico
  direction: string;        // dirección legible
  urgency: 'baja' | 'media' | 'alta' | 'crítica';
  reason: string;
  regimeContext: MacroRegime;
}

export interface RebalanceOracleOutput {
  regime: MacroRegime;
  recommendations: RebalanceRecommendation[];
  summary: string;
  riskLevel: 'bajo' | 'medio' | 'alto' | 'crítico';
  suggestedWeightAdjustments: Record<string, number>; // productId → delta weight
  returnTargetBias: 'por_encima' | 'en_objetivo' | 'por_debajo'; // vs objetivo retorno
}

// ============================================================================
// ORÁCULO REBALANCE — Calcular recomendaciones
// ============================================================================
export function computeRebalance(
  oracle: OracleState,
  allocations: PortfolioAllocation[],
  metrics: PortfolioMetrics | null,
  returnTarget: ReturnTargetMode = 'CRECIMIENTO_MODERADO'
): RebalanceOracleOutput {
  const { regime, devaluationProbability } = oracle;

  const recommendations: RebalanceRecommendation[] = [];
  const adjustments: Record<string, number> = {};

  // Current allocation breakdown by category
  const currentByCategory: Record<string, number> = {};
  for (const a of allocations) {
    currentByCategory[a.category] = (currentByCategory[a.category] || 0) + a.weight;
  }

  // ── RETURN TARGET BIAS ──
  // Determinar si retorno proyectado está por encima/en/por debajo del objetivo
  const projectedReturn = metrics?.expectedRealReturn30d ?? 0;
  const target = RETURN_TARGETS[returnTarget];
  const returnTargetBias: 'por_encima' | 'en_objetivo' | 'por_debajo' =
    projectedReturn > target.monthlyMax ? 'por_encima'
    : projectedReturn >= target.monthlyMin ? 'en_objetivo'
    : 'por_debajo';

  switch (regime) {
    case 'CARRY':
    case 'CARRY_FAVORABLE':
      recommendations.push({
        action: 'MANTENER',
        target: 'Posiciones ARS carry',
        direction: 'Mantener exposición ARS — carry rentable',
        urgency: 'baja',
        reason: `${REGIME_LABELS.CARRY}. Tasas altas, tipo de cambio estable, inflación controlada.`,
        regimeContext: regime,
      });

      if (returnTargetBias === 'por_debajo') {
        // Retorno por debajo del objetivo → sugerir más agresividad
        recommendations.push({
          action: 'ROTAR',
          target: 'Lecaps + tasa fija corta',
          direction: 'Aumentar Lecaps e instrumentos cortos',
          urgency: 'media',
          reason: `Retorno proyectado ${projectedReturn.toFixed(2)}% por debajo del objetivo ${target.monthlyMin}–${target.monthlyMax}%. Rotar de money market a Lecaps para mejorar yield.`,
          regimeContext: regime,
        });
        adjustments['lecaps'] = 0.08;
        adjustments['fondo-corto-plazo'] = 0.05;
        adjustments['super-ahorro'] = -0.10;
        adjustments['dolar-mep'] = 0.05;
      } else if (returnTargetBias === 'por_encima') {
        // Retorno por encima del objetivo → reducir riesgo automáticamente
        recommendations.push({
          action: 'REDUCIR',
          target: 'Posiciones agresivas',
          direction: 'Reducir riesgo — objetivo superado',
          urgency: 'baja',
          reason: `Retorno proyectado ${projectedReturn.toFixed(2)}% supera objetivo ${target.monthlyMax}%. Reducir exposición agresiva, asegurar ganancia.`,
          regimeContext: regime,
        });
        adjustments['super-ahorro'] = 0.05;
        adjustments['dolar-mep'] = -0.03;
        adjustments['lecaps'] = -0.03;
      } else {
        recommendations.push({
          action: 'MANTENER',
          target: 'Distribución actual',
          direction: 'Mantener — retorno en rango objetivo',
          urgency: 'baja',
          reason: `Retorno proyectado ${projectedReturn.toFixed(2)}% dentro del objetivo ${target.monthlyMin}–${target.monthlyMax}%.`,
          regimeContext: regime,
        });
        adjustments['super-ahorro'] = 0.03;
        adjustments['dolar-mep'] = -0.02;
      }

      recommendations.push({
        action: 'MANTENER',
        target: 'PF UVA / CER',
        direction: 'Mantener protección inflacionaria',
        urgency: 'baja',
        reason: 'Inflación controlada. CER/UVA aportan diversificación.',
        regimeContext: regime,
      });
      break;

    case 'NORMAL':
      recommendations.push({
        action: 'MANTENER',
        target: 'Distribución actual',
        direction: 'Mantener asignación base — condiciones normales',
        urgency: 'baja',
        reason: 'Régimen normal. Asignación base: 40% preservación, 25% inflación, 15% carry, 15% USD.',
        regimeContext: regime,
      });

      if (returnTargetBias === 'por_debajo') {
        recommendations.push({
          action: 'ROTAR',
          target: 'Lecaps + CER',
          direction: 'Aumentar yield gradualmente',
          urgency: 'media',
          reason: `Retorno proyectado ${projectedReturn.toFixed(2)}% por debajo del objetivo. Rotar parcialmente a Lecaps y CER para mejorar yield sin aumentar riesgo excesivamente.`,
          regimeContext: regime,
        });
        adjustments['lecaps'] = 0.05;
        adjustments['renta-fija-cer'] = 0.03;
        adjustments['super-ahorro'] = -0.06;
      }
      break;

    case 'HIGH_VOL':
      recommendations.push({
        action: 'REDUCIR',
        target: 'Carry ARS',
        direction: 'Desactivar carry — volatilidad elevada',
        urgency: 'alta',
        reason: 'Alta volatilidad. Carry ARS desactivado. Aumentar preservación y cobertura USD.',
        regimeContext: regime,
      });

      recommendations.push({
        action: 'CUBRIR',
        target: 'USD hedge + Liquidez',
        direction: 'Aumentar cobertura USD y liquidez',
        urgency: 'media',
        reason: 'Volatilidad elevada requiere más protección cambiaria y liquidez inmediata.',
        regimeContext: regime,
      });

      adjustments['super-ahorro'] = 0.10;
      adjustments['dolar-mep'] = 0.05;
      adjustments['super-ahorro-usd'] = 0.03;
      adjustments['lecaps'] = -0.08;
      adjustments['plazo-fijo'] = -0.05;
      break;

    case 'WARNING':
      recommendations.push({
        action: 'ROTAR',
        target: 'CER / Cobertura inflacionaria',
        direction: 'Rotar hacia CER y ajuste inflacionario',
        urgency: 'media',
        reason: 'Inflación acelerando. Reducir ARS nominal, aumentar CER y UVA.',
        regimeContext: regime,
      });

      if (returnTargetBias === 'por_debajo') {
        recommendations.push({
          action: 'AUMENTAR',
          target: 'Lecaps + MEP hedge ligero',
          direction: 'Aumentar yield con cobertura cambiaria',
          urgency: 'media',
          reason: `Retorno por debajo de objetivo. En alerta, aumentar Lecaps y cobertura MEP 5–15%.`,
          regimeContext: regime,
        });
        adjustments['lecaps'] = 0.06;
        adjustments['dolar-mep'] = 0.05;
        adjustments['super-ahorro'] = -0.08;
      } else {
        recommendations.push({
          action: 'REDUCIR',
          target: 'Efectivo ARS / Money Market',
          direction: 'Reducir exposición ARS efectivo',
          urgency: 'media',
          reason: 'TC presionado. Efectivo ARS pierde poder adquisitivo. Rotar a CER.',
          regimeContext: regime,
        });
        adjustments['super-ahorro'] = -0.08;
      }

      adjustments['renta-fija-cer'] = 0.05;
      adjustments['plazo-fijo-uva'] = 0.03;
      break;

    case 'CRISIS':
      recommendations.push({
        action: 'CUBRIR',
        target: 'Dólar MEP / Activos USD',
        direction: 'Cubrir con USD — aumentar MEP',
        urgency: 'crítica',
        reason: 'Riesgo de devaluación alto. Aumentar cobertura cambiaria.',
        regimeContext: regime,
      });
      recommendations.push({
        action: 'REDUCIR',
        target: 'Duration ARS / Plazo Fijo',
        direction: 'Reducir duration ARS',
        urgency: 'alta',
        reason: 'Riesgo de salto cambiario. Plazos fijos en ARS son trampa.',
        regimeContext: regime,
      });
      recommendations.push({
        action: 'ROTAR',
        target: 'Liquidez T+0',
        direction: 'Mover a liquidez inmediata',
        urgency: 'alta',
        reason: 'Necesidad de reaccionar rápido en crisis.',
        regimeContext: regime,
      });

      // Crisis: siempre cubrir, independientemente del target
      adjustments['dolar-mep'] = 0.08;
      adjustments['super-ahorro-usd'] = 0.05;
      adjustments['super-ahorro'] = -0.05;
      adjustments['plazo-fijo'] = -0.05;
      adjustments['plazo-fijo-uva'] = -0.03;
      break;

    case 'GLOBAL_RISK_OFF':
      recommendations.push({
        action: 'CUBRIR',
        target: 'Liquidez + Activos USD',
        direction: 'Mover a liquidez y dólares',
        urgency: 'alta',
        reason: 'Risk-off global. USD fuerte, salida de emergentes.',
        regimeContext: regime,
      });

      if (returnTargetBias === 'por_debajo') {
        recommendations.push({
          action: 'AUMENTAR',
          target: 'USD hedge + CER',
          direction: 'Proteger con USD y CER simultáneamente',
          urgency: 'alta',
          reason: `Retorno bajo objetivo en estrés global. Doble protección: USD + ajuste inflación.`,
          regimeContext: regime,
        });
        adjustments['dolar-mep'] = 0.08;
        adjustments['renta-fija-cer'] = 0.04;
      } else {
        recommendations.push({
          action: 'REDUCIR',
          target: 'Posiciones de yield ARS',
          direction: 'Reducir riesgo ARS',
          urgency: 'media',
          reason: 'Carry no compensa riesgo cambiario. Reducir duration ARS.',
          regimeContext: regime,
        });
        adjustments['dolar-mep'] = 0.05;
      }

      adjustments['super-ahorro'] = -0.03;
      adjustments['super-ahorro-usd'] = 0.03;
      break;
  }

  // Determine overall risk level
  const riskLevel = devaluationProbability >= 60 ? 'crítico'
    : devaluationProbability >= 40 ? 'alto'
    : devaluationProbability >= 20 ? 'medio'
    : 'bajo';

  // Summary — include return target bias context
  const targetLabel = RETURN_TARGETS[returnTarget].label;
  const summary = regime === 'CARRY' || regime === 'CARRY_FAVORABLE'
    ? returnTargetBias === 'por_debajo'
      ? `Régimen estable pero retorno por debajo de objetivo (${targetLabel}) — rotar a yield`
      : `Régimen estable — carry rentable, retorno en objetivo`
    : regime === 'NORMAL'
    ? returnTargetBias === 'por_debajo'
      ? `Régimen normal — retorno por debajo de objetivo, rotar gradualmente a yield`
      : `Régimen normal — asignación base, retorno en rango`
    : regime === 'HIGH_VOL'
    ? 'Alta volatilidad — desactivar carry, aumentar cobertura USD y liquidez'
    : regime === 'WARNING'
    ? 'Precaución — inflación acelerando, rotar a CER'
    : regime === 'CRISIS'
    ? 'Riesgo alto — cubrir con USD, reducir duration ARS'
    : 'Estrés global — proteger con liquidez y dólares';

  return {
    regime,
    recommendations,
    summary,
    riskLevel,
    suggestedWeightAdjustments: adjustments,
    returnTargetBias,
  };
}
