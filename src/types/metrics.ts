/**
 * Metrics Types - Making compute tangible
 *
 * These types track the performance and transparency data
 * that makes the "Glass Box" philosophy possible.
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}

export interface InferenceMetrics {
  startTime: number;
  endTime: number | null;
  firstTokenTime: number | null;

  // Token tracking
  usage: TokenUsage | null;
  tokensGenerated: number;
  chunksReceived: number;

  // Performance
  tokensPerSecond: number;
  timeToFirstToken: number | null;
  totalLatency: number | null;

  // Model info
  model: string;
  requestId: string | null;
}

export interface ThinkingTrace {
  id: string;
  timestamp: number;
  phase: 'generator' | 'critic' | 'resolution';
  content: string;
  isComplete: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  timestamp: number;
  duration: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  factsChecked: number;
  contradictionsFound: number;
  timestamp: number;
}

export interface SystemMetrics {
  totalTurns: number;
  totalTokensUsed: number;
  averageTPS: number;
  validationPassRate: number;
  memoryEntriesCount: number;
  sessionStartTime: number;
}
