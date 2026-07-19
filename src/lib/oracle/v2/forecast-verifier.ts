// Server-safe forecast verification metrics for the canonical V2/V3 pipeline.
// Verification pairs are registered by the lifecycle orchestrator; this module
// contains no React hooks and does not create a second prediction model.

export interface ForecastVerificationReport {
  total_verifications: number;
  MAE: number;
  RMSE: number;
  MAPE: number | null;
  HitRate: number;
  DirectionalAccuracy: number;
  Calibration: number;
  mean_expected_return: number;
  mean_realized_return: number;
  bias: number;
  window_size: number;
  computed_at: string;
  verifier_version: string;
}

export interface VerificationPair {
  prediction_id: string;
  expected_return: number;
  realized_return: number;
  timestamp: string;
}

export const FORECAST_VERIFIER_VERSION = 'forecast_verifier_v2_r4_server_safe';
const MAX_PAIRS_BUFFER = 200;
let pairsBuffer: VerificationPair[] = [];

export function registerVerificationPair(pair: VerificationPair): void {
  if (!pair.prediction_id.trim()) throw new TypeError('prediction_id is required');
  if (![pair.expected_return, pair.realized_return].every(Number.isFinite)) {
    throw new TypeError('verification returns must be finite');
  }
  if (!Number.isFinite(Date.parse(pair.timestamp))) throw new TypeError('verification timestamp must be ISO-8601');
  pairsBuffer.push({ ...pair });
  if (pairsBuffer.length > MAX_PAIRS_BUFFER) pairsBuffer = pairsBuffer.slice(-MAX_PAIRS_BUFFER);
}

export function clearVerificationBuffer(): void {
  pairsBuffer = [];
}

export function getVerificationBuffer(): VerificationPair[] {
  return pairsBuffer.map((pair) => ({ ...pair }));
}

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function computeForecastVerification(): ForecastVerificationReport {
  const pairs = getVerificationBuffer();
  const count = pairs.length;
  if (count === 0) {
    return {
      total_verifications: 0,
      MAE: 0,
      RMSE: 0,
      MAPE: null,
      HitRate: 0.5,
      DirectionalAccuracy: 50,
      Calibration: 0,
      mean_expected_return: 0,
      mean_realized_return: 0,
      bias: 0,
      window_size: 0,
      computed_at: new Date().toISOString(),
      verifier_version: FORECAST_VERIFIER_VERSION,
    };
  }

  const errors = pairs.map((pair) => pair.expected_return - pair.realized_return);
  const absoluteErrors = errors.map(Math.abs);
  const squareErrors = errors.map((error) => error ** 2);
  const validMape = pairs.filter((pair) => Math.abs(pair.expected_return) > 1e-6);
  const meanExpected = pairs.reduce((sum, pair) => sum + pair.expected_return, 0) / count;
  const meanRealized = pairs.reduce((sum, pair) => sum + pair.realized_return, 0) / count;
  const mae = absoluteErrors.reduce((sum, value) => sum + value, 0) / count;
  const mse = squareErrors.reduce((sum, value) => sum + value, 0) / count;
  const hits = pairs.filter((pair) => Math.sign(pair.expected_return) === Math.sign(pair.realized_return)).length;
  const hitRate = hits / count;
  const mape = validMape.length === 0 ? null : validMape.reduce(
    (sum, pair) => sum + Math.abs((pair.expected_return - pair.realized_return) / pair.expected_return),
    0,
  ) / validMape.length * 100;

  return {
    total_verifications: count,
    MAE: round(mae, 6),
    RMSE: round(Math.sqrt(mse), 6),
    MAPE: mape === null ? null : round(mape, 2),
    HitRate: round(hitRate, 3),
    DirectionalAccuracy: round(hitRate * 100, 1),
    Calibration: round(mse, 6),
    mean_expected_return: round(meanExpected, 6),
    mean_realized_return: round(meanRealized, 6),
    bias: round(meanExpected - meanRealized, 6),
    window_size: count,
    computed_at: new Date().toISOString(),
    verifier_version: FORECAST_VERIFIER_VERSION,
  };
}
