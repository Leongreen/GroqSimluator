/**
 * Metrics Panel - Visceral Performance Visualization
 *
 * Makes compute tangible through real-time metrics display.
 * Shows token counts, TPS, latency, and validation status.
 */

import React from 'react';
import type { InferenceMetrics, ValidationResult } from '@/types';

interface MetricsPanelProps {
  metrics: InferenceMetrics | null;
  validation: ValidationResult | null;
  phase: 'idle' | 'generator' | 'critic' | 'resolution';
  currentTurn: number;
  totalTokens: number;
  sessionTPS: number;
}

export const MetricsPanel: React.FC<MetricsPanelProps> = ({
  metrics,
  validation,
  phase,
  currentTurn,
  totalTokens,
  sessionTPS,
}) => {
  const formatNumber = (n: number): string => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  const formatTPS = (tps: number): string => {
    return tps.toFixed(1);
  };

  const formatLatency = (ms: number | null): string => {
    if (ms === null) return '—';
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
    return `${ms.toFixed(0)}ms`;
  };

  return (
    <div className="panel-section metrics">
      <div className="panel-header">
        <span>Performance Metrics</span>
        {phase !== 'idle' && (
          <span className={`phase-indicator ${phase}`}>{phase}</span>
        )}
      </div>
      <div className="panel-content">
        {/* Turn Counter */}
        <div className="turn-counter">
          <div className="turn-label">Turn</div>
          <div>{currentTurn}</div>
        </div>

        {/* Metrics Grid */}
        <div className="metrics-grid">
          <div className="metric-item">
            <div className="metric-label">TPS</div>
            <div className={`metric-value large ${phase !== 'idle' ? 'highlight' : ''}`}>
              {metrics?.tokensPerSecond ? formatTPS(metrics.tokensPerSecond) : formatTPS(sessionTPS)}
            </div>
          </div>

          <div className="metric-item">
            <div className="metric-label">Tokens</div>
            <div className="metric-value">
              {metrics?.tokensGenerated ?? 0}
            </div>
          </div>

          <div className="metric-item">
            <div className="metric-label">TTFT</div>
            <div className="metric-value">
              {formatLatency(metrics?.timeToFirstToken ?? null)}
            </div>
          </div>

          <div className="metric-item">
            <div className="metric-label">Latency</div>
            <div className="metric-value">
              {formatLatency(metrics?.totalLatency ?? null)}
            </div>
          </div>

          <div className="metric-item">
            <div className="metric-label">Session Tokens</div>
            <div className="metric-value">
              {formatNumber(totalTokens)}
            </div>
          </div>

          <div className="metric-item">
            <div className="metric-label">Chunks</div>
            <div className="metric-value">
              {metrics?.chunksReceived ?? 0}
            </div>
          </div>
        </div>

        {/* Validation Result */}
        {validation && (
          <div className={`validation-result ${validation.isValid ? 'valid' : 'invalid'}`}>
            <div className="validation-header">
              <span className="validation-status">
                {validation.isValid ? '✓ VALIDATED' : '✗ REJECTED'}
              </span>
              <span className="validation-details">
                {validation.factsChecked} facts checked
              </span>
            </div>
            {validation.errors.map((error, i) => (
              <div key={i} className="validation-error">
                Error: {error}
              </div>
            ))}
            {validation.warnings.map((warning, i) => (
              <div key={i} className="validation-warning">
                Warning: {warning}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
