/**
 * Header - Status bar and branding
 *
 * Shows the application title and real-time status indicators.
 */

import React from 'react';
import type { WorldTime } from '@/types';

interface HeaderProps {
  worldName: string;
  worldTime: WorldTime | null;
  weather: string;
  status: 'idle' | 'processing' | 'error';
  connectionStatus: 'connected' | 'disconnected';
}

export const Header: React.FC<HeaderProps> = ({
  worldName,
  worldTime,
  weather,
  status,
  connectionStatus,
}) => {
  const formatTime = (time: WorldTime): string => {
    const hour = time.hour % 12 || 12;
    const period = time.hour >= 12 ? 'PM' : 'AM';
    return `${hour}:00 ${period}`;
  };

  const formatDate = (time: WorldTime): string => {
    return `Day ${time.day}, Month ${time.month}, Year ${time.year}`;
  };

  return (
    <header className="header">
      <div className="header-title">
        <h1>Groq RPG</h1>
        <span style={{ color: 'var(--text-dim)' }}>|</span>
        <span style={{ color: 'var(--text-secondary)' }}>{worldName}</span>
      </div>

      <div className="header-status">
        {worldTime && (
          <>
            <div className="status-item">
              <span style={{ color: 'var(--accent-yellow)' }}>☀</span>
              <span>{formatTime(worldTime)}</span>
            </div>
            <div className="status-item">
              <span style={{ color: 'var(--text-dim)' }}>📅</span>
              <span>{formatDate(worldTime)}</span>
            </div>
            <div className="status-item">
              <span>{getWeatherEmoji(weather)}</span>
              <span>{weather}</span>
            </div>
          </>
        )}
        <div className="status-item">
          <div className={`status-indicator ${status}`} />
          <span>{status === 'processing' ? 'Processing' : status === 'error' ? 'Error' : 'Ready'}</span>
        </div>
        <div className="status-item">
          <div className={`status-indicator ${connectionStatus === 'connected' ? '' : 'error'}`} />
          <span>Groq</span>
        </div>
      </div>
    </header>
  );
};

function getWeatherEmoji(weather: string): string {
  const map: Record<string, string> = {
    clear: '☀️',
    cloudy: '☁️',
    rainy: '🌧️',
    stormy: '⛈️',
    foggy: '🌫️',
    windy: '💨',
    snowy: '❄️',
  };
  return map[weather.toLowerCase()] || '🌤️';
}
