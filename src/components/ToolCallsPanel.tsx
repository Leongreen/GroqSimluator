/**
 * Tool Calls Panel - Glass Box Tool Usage Display
 *
 * Shows all tool invocations in real-time, making the
 * system's actions transparent to the user.
 */

import React, { useEffect, useRef } from 'react';
import type { AccumulatedToolCall } from '@/services/groqService';

interface ToolCallsPanelProps {
  toolCalls: AccumulatedToolCall[];
  isStreaming: boolean;
}

export const ToolCallsPanel: React.FC<ToolCallsPanelProps> = ({
  toolCalls,
  isStreaming,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [toolCalls]);

  const getToolColor = (name: string): string => {
    if (name.includes('log_world_event')) return 'var(--accent-purple)';
    if (name.includes('update_npc')) return 'var(--accent-orange)';
    if (name.includes('draft_response')) return 'var(--accent-green)';
    if (name.includes('validation')) return 'var(--accent-blue)';
    return 'var(--accent-blue)';
  };

  const formatArgs = (args: string): string => {
    try {
      const parsed = JSON.parse(args);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return args.slice(0, 100) + (args.length > 100 ? '...' : '');
    }
  };

  return (
    <div className="panel-section tools">
      <div className="panel-header">
        <span>Tool Invocations</span>
        <span style={{ color: 'var(--text-dim)' }}>
          {toolCalls.length} calls
        </span>
      </div>
      <div className="panel-content" ref={containerRef}>
        {toolCalls.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: 'var(--font-sm)' }}>
            No tool calls yet...
          </div>
        ) : (
          toolCalls.map((tc, idx) => (
            <div key={tc.id || idx} className="tool-call">
              <div className="tool-header">
                <span className="tool-name" style={{ color: getToolColor(tc.name) }}>
                  {tc.name}
                </span>
                <span className="tool-status">
                  {isStreaming && idx === toolCalls.length - 1 ? '...' : '✓'}
                </span>
              </div>
              <div className="tool-args">
                {formatArgs(tc.arguments)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
