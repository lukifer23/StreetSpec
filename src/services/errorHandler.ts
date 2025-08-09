import { AppError, ErrorContext, ErrorHandler, ErrorSeverity, ErrorCategory, createError } from '../types/common';

class ErrorHandlerService implements ErrorHandler {
  private errorLog: AppError[] = [];
  private readonly maxLogSize = 1000;
  private retryDelays = [1000, 2000, 5000]; // Exponential backoff delays

  constructor() {
    // Set up global error handlers
    this.setupGlobalErrorHandlers();
  }

  private setupGlobalErrorHandlers(): void {
    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      const error = createError(
        'SYSTEM_UNKNOWN',
        `Unhandled promise rejection: ${event.reason}`,
        'An unexpected error occurred. Please try again.',
        ErrorSeverity.HIGH,
        ErrorCategory.SYSTEM,
        { reason: event.reason },
        true
      );
      this.handleError(error, { action: 'unhandledrejection' });
    });

    // Handle JavaScript errors
    window.addEventListener('error', (event) => {
      const error = createError(
        'SYSTEM_UNKNOWN',
        `JavaScript error: ${event.message}`,
        'An unexpected error occurred. Please refresh the page.',
        ErrorSeverity.MEDIUM,
        ErrorCategory.SYSTEM,
        { 
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          error: event.error
        },
        true
      );
      this.handleError(error, { action: 'error' });
    });
  }

  async handleError(error: AppError, context?: ErrorContext): Promise<void> {
    // Add context to error
    const enrichedError = {
      ...error,
      details: {
        ...error.details,
        context
      }
    };

    // Log the error
    this.logError(enrichedError, context);

    // Show user-friendly error if severity is medium or higher
    if (enrichedError.severity >= ErrorSeverity.MEDIUM) {
      this.showUserError(enrichedError);
    }

    // Handle critical errors
    if (enrichedError.severity === ErrorSeverity.CRITICAL) {
      await this.handleCriticalError(enrichedError);
    }

    // Store error in log
    this.addToLog(enrichedError);
  }

  logError(error: AppError, context?: ErrorContext): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      error: {
        id: error.id,
        code: error.code,
        message: error.message,
        severity: error.severity,
        category: error.category,
        stack: error.stack
      },
      context,
      userAgent: navigator.userAgent,
      url: window.location.href
    };

    // Log to console with appropriate level
    switch (error.severity) {
      case ErrorSeverity.LOW:
        console.log('[ERROR]', logEntry);
        break;
      case ErrorSeverity.MEDIUM:
        console.warn('[ERROR]', logEntry);
        break;
      case ErrorSeverity.HIGH:
      case ErrorSeverity.CRITICAL:
        console.error('[ERROR]', logEntry);
        break;
    }

    // In production, you might want to send to a logging service
    if (process.env.NODE_ENV === 'production') {
      this.sendToLoggingService(logEntry);
    }
  }

  showUserError(error: AppError): void {
    // Create a user-friendly notification
    const notification = document.createElement('div');
    notification.className = `error-notification error-${error.severity}`;
    notification.innerHTML = `
      <div class="error-header">
        <span class="error-icon">⚠️</span>
        <span class="error-title">${this.getErrorTitle(error)}</span>
        <button class="error-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
      <div class="error-message">${error.userFriendlyMessage}</div>
      ${error.recoverable ? '<div class="error-actions"><button onclick="this.parentElement.parentElement.remove()">Dismiss</button></div>' : ''}
    `;

    // Add styles
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${this.getErrorColor(error.severity)};
      color: white;
      padding: 15px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      max-width: 400px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Add to page
    document.body.appendChild(notification);

    // Auto-remove after 10 seconds for non-critical errors
    if (error.severity !== ErrorSeverity.CRITICAL) {
      setTimeout(() => {
        if (notification.parentElement) {
          notification.remove();
        }
      }, 10000);
    }
  }

  isRecoverable(error: AppError): boolean {
    return error.recoverable && (error.retryCount || 0) < (error.maxRetries || 3);
  }

  async retryOperation<T>(operation: () => Promise<T>, error: AppError): Promise<T> {
    if (!this.isRecoverable(error)) {
      throw error;
    }

    const retryCount = (error.retryCount || 0) + 1;
    const delay = this.retryDelays[Math.min(retryCount - 1, this.retryDelays.length - 1)];

    // Update retry count
    error.retryCount = retryCount;

    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      return await operation();
    } catch (retryError) {
      if (retryCount >= (error.maxRetries || 3)) {
        // Final failure
        const finalError = createError(
          error.code as any,
          `Operation failed after ${retryCount} retries: ${error.message}`,
          'The operation failed after multiple attempts. Please try again later.',
          ErrorSeverity.HIGH,
          error.category,
          { originalError: error, retryCount },
          false
        );
        throw finalError;
      } else {
        // Try again
        return this.retryOperation(operation, error);
      }
    }
  }

  private async handleCriticalError(error: AppError): Promise<void> {
    // For critical errors, we might want to:
    // 1. Save current state
    // 2. Show a modal dialog
    // 3. Offer to restart the application
    
    const modal = document.createElement('div');
    modal.innerHTML = `
      <div class="critical-error-modal">
        <h2>Critical Error</h2>
        <p>${error.userFriendlyMessage}</p>
        <p>Please save your work and restart the application.</p>
        <button onclick="window.location.reload()">Restart Application</button>
        <button onclick="this.parentElement.parentElement.remove()">Continue (Not Recommended)</button>
      </div>
    `;

    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10001;
    `;

    document.body.appendChild(modal);
  }

  private getErrorTitle(error: AppError): string {
    switch (error.severity) {
      case ErrorSeverity.LOW:
        return 'Information';
      case ErrorSeverity.MEDIUM:
        return 'Warning';
      case ErrorSeverity.HIGH:
        return 'Error';
      case ErrorSeverity.CRITICAL:
        return 'Critical Error';
      default:
        return 'Error';
    }
  }

  private getErrorColor(severity: ErrorSeverity): string {
    switch (severity) {
      case ErrorSeverity.LOW:
        return '#2196F3';
      case ErrorSeverity.MEDIUM:
        return '#FF9800';
      case ErrorSeverity.HIGH:
        return '#F44336';
      case ErrorSeverity.CRITICAL:
        return '#9C27B0';
      default:
        return '#F44336';
    }
  }

  private addToLog(error: AppError): void {
    this.errorLog.push(error);
    
    // Maintain log size
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxLogSize);
    }
  }

  private sendToLoggingService(logEntry: any): void {
    // In a real application, you would send this to a logging service
    // For now, we'll just store it in localStorage for debugging
    try {
      const existingLogs = JSON.parse(localStorage.getItem('errorLogs') || '[]');
      existingLogs.push(logEntry);
      
      // Keep only last 100 entries
      if (existingLogs.length > 100) {
        existingLogs.splice(0, existingLogs.length - 100);
      }
      
      localStorage.setItem('errorLogs', JSON.stringify(existingLogs));
    } catch (e) {
      console.warn('Failed to store error log:', e);
    }
  }

  // Public methods for external use
  getErrorLog(): AppError[] {
    return [...this.errorLog];
  }

  clearErrorLog(): void {
    this.errorLog = [];
  }

  getErrorStats(): { total: number; bySeverity: Record<ErrorSeverity, number>; byCategory: Record<ErrorCategory, number> } {
    const bySeverity: Record<ErrorSeverity, number> = {
      [ErrorSeverity.LOW]: 0,
      [ErrorSeverity.MEDIUM]: 0,
      [ErrorSeverity.HIGH]: 0,
      [ErrorSeverity.CRITICAL]: 0
    };

    const byCategory: Record<ErrorCategory, number> = {
      [ErrorCategory.NETWORK]: 0,
      [ErrorCategory.MODEL]: 0,
      [ErrorCategory.GEOMETRY]: 0,
      [ErrorCategory.MEASUREMENT]: 0,
      [ErrorCategory.STORAGE]: 0,
      [ErrorCategory.UI]: 0,
      [ErrorCategory.SYSTEM]: 0,
      [ErrorCategory.UNKNOWN]: 0
    };

    this.errorLog.forEach(error => {
      bySeverity[error.severity]++;
      byCategory[error.category]++;
    });

    return {
      total: this.errorLog.length,
      bySeverity,
      byCategory
    };
  }
}

// Create singleton instance
export const errorHandler = new ErrorHandlerService();

// Export convenience functions
export const handleError = (error: AppError, context?: ErrorContext) => errorHandler.handleError(error, context);
export const logError = (error: AppError, context?: ErrorContext) => errorHandler.logError(error, context);
export const showUserError = (error: AppError) => errorHandler.showUserError(error);
export const isRecoverable = (error: AppError) => errorHandler.isRecoverable(error);
export const retryOperation = <T>(operation: () => Promise<T>, error: AppError) => errorHandler.retryOperation(operation, error);
