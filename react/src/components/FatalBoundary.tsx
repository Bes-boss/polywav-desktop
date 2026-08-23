// FatalErrorBoundary — mirrors the shipping app's #fatalError overlay.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { IconX } from './icons';

interface State { error: Error | null; }

export class FABoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[polywav] fatal:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal-overlay" role="alert">
        <div className="fatal-card">
          <div className="fatal-icon"><IconX size={22} /></div>
          <h2>Something went wrong</h2>
          <p>{this.state.error.message || 'Unknown error'}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}