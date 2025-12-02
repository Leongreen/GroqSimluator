/**
 * Groq RPG Simulator - Main Application
 *
 * The Glass Box Terminal Interface for the Reality Engine.
 * A high-fidelity terminal aesthetic that makes compute tangible.
 */

import React from 'react';
import {
  Header,
  TerminalOutput,
  InputArea,
  MetricsPanel,
  ThinkingPanel,
  ToolCallsPanel,
} from './components';
import { useGameSession } from './hooks';
import './styles/terminal.css';

export const App: React.FC = () => {
  const {
    isInitialized,
    isProcessing,
    worldState,
    messages,
    streamingContent,
    thinkingTraces,
    toolCalls,
    currentMetrics,
    lastValidation,
    currentPhase,
    sessionStats,
    error,
    processInput,
  } = useGameSession();

  if (!isInitialized) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading">
          <div className="loading-spinner" />
          <span>Initializing Reality Engine...</span>
        </div>
      </div>
    );
  }

  if (error && !worldState) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--accent-red)', textAlign: 'center' }}>
          <div style={{ fontSize: 'var(--font-xl)', marginBottom: 'var(--space-md)' }}>
            INITIALIZATION FAILED
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Header */}
      <Header
        worldName={worldState?.name ?? 'Unknown World'}
        worldTime={worldState?.time ?? null}
        weather={worldState?.weather ?? 'unknown'}
        status={isProcessing ? 'processing' : error ? 'error' : 'idle'}
        connectionStatus="connected"
      />

      {/* Main Content Area */}
      <main className="main-content">
        <TerminalOutput
          messages={messages}
          streamingContent={streamingContent}
          isStreaming={isProcessing}
        />
        <InputArea
          onSubmit={processInput}
          isDisabled={isProcessing}
          placeholder="What do you do?"
        />
      </main>

      {/* Side Panel - Glass Box */}
      <aside className="side-panel">
        <MetricsPanel
          metrics={currentMetrics}
          validation={lastValidation}
          phase={currentPhase}
          currentTurn={worldState?.currentTurn ?? 0}
          totalTokens={sessionStats.totalTokens}
          sessionTPS={sessionStats.averageTPS}
        />
        <ThinkingPanel
          traces={thinkingTraces}
          isStreaming={isProcessing && currentPhase !== 'idle'}
        />
        <ToolCallsPanel
          toolCalls={toolCalls}
          isStreaming={isProcessing}
        />
      </aside>
    </div>
  );
};

export default App;
