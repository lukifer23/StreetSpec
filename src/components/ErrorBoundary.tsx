import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error details
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });

    // Call optional error handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Report to error tracking service in production
    if (process.env.NODE_ENV === 'production') {
      // Example: Send to error tracking service
      // errorTracker.captureException(error, { extra: errorInfo });
    }
  }

  render() {
    if (this.state.hasError) {
      // Custom fallback UI or default error UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          padding: '20px',
          margin: '20px',
          border: '1px solid #ff6b6b',
          borderRadius: '8px',
          backgroundColor: '#fff5f5',
          color: '#d63031',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
          <h2 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>
            ⚠️ Something went wrong
          </h2>

          <p style={{ margin: '0 0 12px 0', lineHeight: 1.5 }}>
            An unexpected error occurred in Street Spec Desktop. This might be due to:
          </p>

          <ul style={{ margin: '0 0 16px 0', paddingLeft: '20px' }}>
            <li>A temporary network issue</li>
            <li>Corrupted browser data</li>
            <li>A bug in the application</li>
          </ul>

          <div style={{ marginBottom: '16px' }}>
            <strong>Error details:</strong>
            <details style={{ marginTop: '8px' }}>
              <summary style={{
                cursor: 'pointer',
                padding: '4px 8px',
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '4px',
                fontSize: '14px'
              }}>
                Click to view technical details
              </summary>
              <pre style={{
                margin: '8px 0 0 0',
                padding: '8px',
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '4px',
                fontSize: '12px',
                overflow: 'auto',
                maxHeight: '200px'
              }}>
                {this.state.error?.message}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              🔄 Reload Page
            </button>

            <button
              onClick={() => {
                // Clear local storage and reload
                localStorage.clear();
                sessionStorage.clear();
                window.location.reload();
              }}
              style={{
                padding: '8px 16px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              🗑️ Clear Data & Reload
            </button>

            <button
              onClick={() => this.setState({ hasError: false, error: undefined, errorInfo: undefined })}
              style={{
                padding: '8px 16px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              🔄 Try Again
            </button>
          </div>

          <p style={{
            margin: '16px 0 0 0',
            fontSize: '12px',
            color: '#6c757d',
            fontStyle: 'italic'
          }}>
            If this problem persists, please report it to our support team.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

// Higher-order component for easier usage
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode,
  onError?: (error: Error, errorInfo: ErrorInfo) => void
) {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary fallback={fallback} onError={onError}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;

  return WrappedComponent;
}
