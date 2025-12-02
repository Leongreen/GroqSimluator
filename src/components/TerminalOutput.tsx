/**
 * Terminal Output - The main narrative display
 *
 * Renders the game's output with typing effect and
 * categorized message types.
 */

import React, { useEffect, useRef } from 'react';

export interface TerminalMessage {
  id: string;
  type: 'system' | 'player' | 'narrative' | 'error' | 'world-event';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

interface TerminalOutputProps {
  messages: TerminalMessage[];
  streamingContent: string;
  isStreaming: boolean;
}

export const TerminalOutput: React.FC<TerminalOutputProps> = ({
  messages,
  streamingContent,
  isStreaming,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const formatTimestamp = (ts: number): string => {
    const date = new Date(ts);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getMessageLabel = (type: TerminalMessage['type']): string => {
    switch (type) {
      case 'system': return 'SYSTEM';
      case 'player': return 'PLAYER';
      case 'narrative': return 'WORLD';
      case 'error': return 'ERROR';
      case 'world-event': return 'EVENT';
      default: return 'MSG';
    }
  };

  return (
    <div className="terminal-output" ref={containerRef}>
      {messages.map((msg) => (
        <div key={msg.id} className={`message ${msg.type}`}>
          <div className="message-header">
            <span>{getMessageLabel(msg.type)}</span>
            <span>{formatTimestamp(msg.timestamp)}</span>
          </div>
          <div className="message-content">
            {msg.content}
          </div>
        </div>
      ))}

      {/* Streaming content */}
      {isStreaming && streamingContent && (
        <div className="message narrative">
          <div className="message-header">
            <span>WORLD</span>
            <span>NOW</span>
          </div>
          <div className="message-content streaming-text">
            {streamingContent}
          </div>
        </div>
      )}
    </div>
  );
};
