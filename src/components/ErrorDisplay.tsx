import React, { useState, useCallback, useEffect } from 'react';
import type { AppError } from '../types/common';
import styles from './ErrorDisplay.module.css';

interface ErrorDisplayProps {
  error: AppError;
  onDismiss?: () => void;
  onRetry?: () => void;
  autoDismiss?: boolean;
  dismissDelay?: number;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
  error,
  onDismiss,
  onRetry,
  autoDismiss = true,
  dismissDelay = 8000
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (autoDismiss && error.severity !== 'critical') {
      const timer = setTimeout(() => {
        setIsVisible(false);
        onDismiss?.();
      }, dismissDelay);
      return () => clearTimeout(timer);
    }
  }, [autoDismiss, dismissDelay, error.severity, onDismiss]);

  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    onDismiss?.();
  }, [onDismiss]);

  const handleRetry = useCallback(() => {
    if (onRetry) {
      onRetry();
    }
  }, [onRetry]);

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  if (!isVisible) {
    return null;
  }

  const severityClass = `error-${error.severity}`;
  const canRetry = error.recoverable && (error.retryCount || 0) < (error.maxRetries || 3);

  return (
    <div className={`${styles['errorDisplay']} ${styles[severityClass]}`} role="alert">
      <div className={styles['errorHeader']}>
        <div className={styles['errorIcon']}>
          {error.severity === 'critical' && '🚨'}
          {error.severity === 'error' && '⚠️'}
          {error.severity === 'warning' && '⚡'}
          {error.severity === 'info' && 'ℹ️'}
        </div>
        <div className={styles['errorContent']}>
          <div className={styles['errorTitle']}>
            {error.category === 'network' && 'Network Error'}
            {error.category === 'validation' && 'Validation Error'}
            {error.category === 'calculation' && 'Calculation Error'}
            {error.category === 'system' && 'System Error'}
            {error.category === 'user' && 'User Error'}
            {!error.category && 'Error'}
          </div>
          <div className={styles['errorMessage']}>
            {error.userFriendlyMessage || error.message}
          </div>
        </div>
        <div className={styles['errorActions']}>
          {canRetry && onRetry && (
            <button
              onClick={handleRetry}
              className={styles['retryButton']}
              title="Retry operation"
            >
              🔄 Retry
            </button>
          )}
          <button
            onClick={handleDismiss}
            className={styles['dismissButton']}
            title="Dismiss"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      </div>

      {(error.details || error.stack || error.context) && (
        <div className={styles['errorDetails']}>
          <button
            onClick={toggleExpand}
            className={styles['expandButton']}
            aria-expanded={isExpanded}
          >
            {isExpanded ? '▼' : '▶'} Details
          </button>
          {isExpanded && (
            <div className={styles['detailsContent']}>
              {error.details && (
                <div className={styles['detailSection']}>
                  <strong>Details:</strong>
                  <pre>{JSON.stringify(error.details, null, 2)}</pre>
                </div>
              )}
              {error.stack && (
                <div className={styles['detailSection']}>
                  <strong>Stack Trace:</strong>
                  <pre className={styles['stackTrace']}>{error.stack}</pre>
                </div>
              )}
              {error.context && (
                <div className={styles['detailSection']}>
                  <strong>Context:</strong>
                  <pre>{JSON.stringify(error.context, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error.timestamp && (
        <div className={styles['errorTimestamp']}>
          {new Date(error.timestamp).toLocaleString()}
        </div>
      )}
    </div>
  );
};

interface ErrorListProps {
  errors: AppError[];
  onDismiss?: (errorId: string) => void;
  onRetry?: (error: AppError) => void;
  maxVisible?: number;
}

export const ErrorList: React.FC<ErrorListProps> = ({
  errors,
  onDismiss,
  onRetry,
  maxVisible = 5
}) => {
  const visibleErrors = errors.slice(0, maxVisible);

  return (
    <div className={styles['errorList']}>
      {visibleErrors.map((error) => (
        <ErrorDisplay
          key={error.id}
          error={error}
          onDismiss={() => onDismiss?.(error.id)}
          onRetry={() => onRetry?.(error)}
        />
      ))}
      {errors.length > maxVisible && (
        <div className={styles['errorOverflow']}>
          +{errors.length - maxVisible} more error{errors.length - maxVisible !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

