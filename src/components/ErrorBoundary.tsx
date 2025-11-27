import React, { Component, type ErrorInfo, type ReactNode, type ComponentType } from 'react';
import { errorHandler } from '../services/errorHandler';
import { createError, ErrorSeverity, ErrorCategory } from '../types/common';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  componentName?: string;
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

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error details
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });

    // Convert React error to AppError and handle through error handler
    const appError = createError(
      'UI_RENDER_FAILED',
      `React component error: ${error.message}`,
      'A component failed to render. The interface may not update correctly.',
      ErrorSeverity.HIGH,
      ErrorCategory.UI,
      {
        component: this.props['componentName'] || 'Unknown',
        errorStack: error.stack,
        componentStack: errorInfo.componentStack,
        originalError: error.message
      },
      true,
      1
    );

    // Handle through error handler service
    errorHandler.handleError(appError, {
      component: this.props['componentName'] || 'ErrorBoundary',
      action: 'componentDidCatch',
      data: {
        errorMessage: error.message,
        componentStack: errorInfo.componentStack
      }
    });

    // Call optional error handler
    if (this.props['onError']) {
      this.props['onError'](error, errorInfo);
    }
  }

  override render() {
    if (this.state['hasError']) {
      // Custom fallback UI or default error UI
      if (this.props['fallback']) {
        return this.props['fallback'];
      }

      return React.createElement('div', {
        style: {
          padding: '20px',
          margin: '20px',
          border: '1px solid #ff6b6b',
          borderRadius: '8px',
          backgroundColor: '#fff5f5',
          color: '#d63031',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }
      },
        React.createElement('h2', { style: { margin: '0 0 16px 0', fontSize: '18px' } }, 'Oops, something went wrong'),
        React.createElement('p', { style: { margin: '0 0 12px 0', lineHeight: 1.5 } }, 'An unexpected error occurred in Street Spec Desktop. This might be due to:'),
        React.createElement('ul', { style: { margin: '0 0 16px 0', paddingLeft: '20px' } },
          React.createElement('li', null, 'A temporary network issue'),
          React.createElement('li', null, 'Corrupted browser data'),
          React.createElement('li', null, 'A bug in the application')
        ),
        React.createElement('div', { style: { marginBottom: '16px' } },
          React.createElement('strong', null, 'Error details:'),
          React.createElement('details', { style: { marginTop: '8px' } },
            React.createElement('summary', {
              style: {
                cursor: 'pointer',
                padding: '4px 8px',
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '4px',
                fontSize: '14px'
              }
            }, 'Click to view technical details'),
            React.createElement('pre', {
              style: {
                margin: '8px 0 0 0',
                padding: '8px',
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '4px',
                fontSize: '12px',
                overflow: 'auto',
                maxHeight: '200px'
              }
            }, this.state['error']?.message, this.state['errorInfo']?.componentStack)
          )
        ),
        React.createElement('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap' } },
          React.createElement('button', {
            onClick: () => window.location.reload(),
            style: {
              padding: '8px 16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }
          }, 'Reload Page'),
          React.createElement('button', {
            onClick: () => {
              localStorage.clear();
              sessionStorage.clear();
              window.location.reload();
            },
            style: {
              padding: '8px 16px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }
          }, 'Clear Data & Reload'),
          React.createElement('button', {
            onClick: () => this.setState({ hasError: false, error: undefined, errorInfo: undefined }),
            style: {
              padding: '8px 16px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }
          }, 'Try Again')
        ),
        React.createElement('p', {
          style: {
            margin: '16px 0 0 0',
            fontSize: '12px',
            color: '#6c757d',
            fontStyle: 'italic'
          }
        }, 'If this problem persists, please report it to our support team.')
      );
    }

    return this.props['children'];
  }
}

// Higher-order component for easier usage
export function withErrorBoundary<P extends object>(
  ComponentToWrap: ComponentType<P>,
  fallback?: ReactNode,
  onError?: (error: Error, errorInfo: ErrorInfo) => void
) {
  const WrappedComponent = (props: P) => {
    return (
      <ErrorBoundary fallback={fallback} onError={onError}>
        <ComponentToWrap {...props} />
      </ErrorBoundary>
    );
  };

  WrappedComponent.displayName = `withErrorBoundary(${ComponentToWrap.displayName || ComponentToWrap.name})`;

  return WrappedComponent;
}

