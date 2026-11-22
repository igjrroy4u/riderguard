import React, { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
  isQuota: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: '',
    isQuota: false,
  };

  static getDerivedStateFromError(error: Error): State {
    let parsedMessage = error.message || 'An unexpected error occurred.';
    let isQuota = parsedMessage.toLowerCase().includes('quota exceeded');

    try {
      const parsed = JSON.parse(error.message) as { error?: string; operationType?: string; path?: string };
      if (parsed.error) {
        isQuota = parsed.error.toLowerCase().includes('quota exceeded');
        parsedMessage = isQuota
          ? 'Daily database quota exceeded. Quota resets tomorrow.'
          : `Database operation (${parsed.operationType || 'access'}) on ${parsed.path || 'record'} was denied: ${parsed.error}`;
      }
    } catch {
      // Plain error message
    }

    return {
      hasError: true,
      message: parsedMessage,
      isQuota,
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('RiderGuard ErrorBoundary caught:', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, message: '', isQuota: false });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-8">
            <div className="flex items-center gap-3 text-red-700 mb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-xl font-semibold text-slate-900">
                {this.state.isQuota ? 'Database Quota Limit Reached' : 'Application Recovery Required'}
              </h1>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-6">{this.state.message}</p>
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Reload RiderGuard
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
