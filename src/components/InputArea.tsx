/**
 * Input Area - Player command entry
 *
 * Handles player input with command history and
 * visual feedback for processing state.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

interface InputAreaProps {
  onSubmit: (input: string) => void;
  isDisabled: boolean;
  placeholder?: string;
}

export const InputArea: React.FC<InputAreaProps> = ({
  onSubmit,
  isDisabled,
  placeholder = 'Enter your action...',
}) => {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount and when enabled
  useEffect(() => {
    if (!isDisabled && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isDisabled]);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isDisabled) return;

    // Add to history
    setHistory(prev => [...prev, trimmed]);
    setHistoryIndex(-1);

    // Submit and clear
    onSubmit(trimmed);
    setInput('');
  }, [input, isDisabled, onSubmit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setInput(history[history.length - 1 - newIndex] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(history[history.length - 1 - newIndex] || '');
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  }, [handleSubmit, history, historyIndex]);

  return (
    <div className="input-area">
      <div className="input-container">
        <span className="input-prompt">&gt;</span>
        <input
          ref={inputRef}
          type="text"
          className="input-field"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
          placeholder={isDisabled ? 'Processing...' : placeholder}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </div>
  );
};
