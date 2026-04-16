'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * ErrorBoundary — catches client-side exceptions (e.g., socket disconnect
 * causing undefined state) and shows a recovery UI instead of crashing.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: '100vh', background: '#0d1117',
          color: '#e0e0e0', gap: '1rem',
        }}>
          <h2 style={{ color: '#ffd700' }}>⚠ 页面异常</h2>
          <p>连接可能已中断，请刷新页面重试</p>
          <button
            onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
            style={{
              padding: '0.5rem 1.5rem', background: '#21262d', color: '#e0e0e0',
              border: '1px solid #30363d', borderRadius: '4px', cursor: 'pointer',
            }}
          >
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
