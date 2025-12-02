/**
 * Thinking Panel - Glass Box Transparency
 *
 * Displays the AI's thinking trace in real-time.
 * Shows the internal reasoning of both Generator and Critic.
 */

import React, { useEffect, useRef } from 'react';
import type { ThinkingTrace } from '@/types';

interface ThinkingPanelProps {
  traces: ThinkingTrace[];
  isStreaming: boolean;
}

export const ThinkingPanel: React.FC<ThinkingPanelProps> = ({
  traces,
  isStreaming,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new traces arrive
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [traces]);

  const getPhaseColor = (phase: ThinkingTrace['phase']): string => {
    switch (phase) {
      case 'generator': return 'var(--accent-green)';
      case 'critic': return 'var(--accent-orange)';
      case 'resolution': return 'var(--accent-purple)';
      default: return 'var(--text-secondary)';
    }
  };

  return (
    <div className="panel-section thinking">
      <div className="panel-header">
        <span>Thinking Trace</span>
        {isStreaming && (
          <div className="loading">
            <div className="loading-spinner" />
            <span>Processing</span>
          </div>
        )}
      </div>
      <div className="panel-content thinking-trace" ref={containerRef}>
        {traces.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>
            Awaiting input...
          </div>
        ) : (
          traces.map((trace) => (
            <div key={trace.id} className="thinking-entry">
              <div
                className="thinking-phase"
                style={{ color: getPhaseColor(trace.phase) }}
              >
                [{trace.phase.toUpperCase()}]
              </div>
              <div className={`thinking-content ${!trace.isComplete ? 'streaming-text' : ''}`}>
                {trace.content || '...'}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
