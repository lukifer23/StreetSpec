import { ErrorSeverity, createError, ErrorCategory } from '../types/common';
import type { AppError, ErrorContext, ErrorHandler } from '../types/common';

class ErrorHandlerService implements ErrorHandler {
  private errorLog: AppError[] = [];
  private readonly maxLogSize = 1000;
  private retryDelays = [1000, 2000, 5000]; // Exponential backoff delays
  private readonly severityRank: Record<ErrorSeverity, number> = {
    [ErrorSeverity.LOW]: 0,
    [ErrorSeverity.MEDIUM]: 1,
    [ErrorSeverity.HIGH]: 2,
    [ErrorSeverity.CRITICAL]: 3
  };

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
    const baseDetails =
      error.details && typeof error.details === 'object'
        ? (error.details as Record<string, unknown>)
        : {};

    const enrichedError = {
      ...error,
      details: {
        ...baseDetails,
        context
      }
    };

    // Log the error
    this.logError(enrichedError, context);

    // Show user-friendly error if severity is medium or higher
    if (this.severityRank[enrichedError.severity] >= this.severityRank[ErrorSeverity.MEDIUM]) {
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
    if (!import.meta.env.DEV) {
      this.sendToLoggingService(logEntry);
    }
  }

  showUserError(error: AppError): void {
    // Use the notification store if available for better UX
    try {
      import('../stores/notificationStore').then(({ pushNotification }) => {
        const kind = error.severity === ErrorSeverity.CRITICAL || error.severity === ErrorSeverity.HIGH
          ? 'error'
          : error.severity === ErrorSeverity.MEDIUM
            ? 'warning'
            : 'info';

        const userMessage = this.getUserFriendlyMessage(error);
        const title = this.getErrorTitle(error);

        pushNotification({
          kind,
          title,
          message: userMessage,
          timeoutMs: error.severity === ErrorSeverity.CRITICAL ? 0 : 8000
        });
      }).catch(() => {
        // Fallback to DOM notification if notification store fails
        this.showFallbackNotification(error);
      });
    } catch (e) {
      // Fallback to DOM notification
      this.showFallbackNotification(error);
    }
  }

  private showFallbackNotification(error: AppError): void {
    // Fallback DOM-based notification
    const notification = document.createElement('div');
    notification.className = `error-notification error-${error.severity}`;
    const userMessage = this.getUserFriendlyMessage(error);
    const title = this.getErrorTitle(error);
    notification.innerHTML = `
      <div class="error-header">
        <span class="error-icon">!</span>
        <span class="error-title">${title}</span>
        <button class="error-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
      <div class="error-message">${userMessage}</div>
    `;

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

    document.body.appendChild(notification);

    if (error.severity !== ErrorSeverity.CRITICAL) {
      setTimeout(() => {
        if (notification.parentElement) {
          notification.remove();
        }
      }, 8000);
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
    // Provide context-specific titles based on error code
    const codeTitles: Record<string, string> = {
      'NETWORK_TIMEOUT': 'Connection Timeout',
      'NETWORK_UNREACHABLE': 'Network Unavailable',
      'API_RATE_LIMITED': 'Rate Limit Exceeded',
      'API_UNAUTHORIZED': 'Authentication Error',
      'MODEL_LOAD_FAILED': 'Model Loading Failed',
      'MODEL_INFERENCE_FAILED': 'Depth Estimation Failed',
      'MODEL_MEMORY_ERROR': 'Memory Error',
      'GEOMETRY_INVALID_POINT': 'Invalid Measurement Point',
      'GEOMETRY_CALCULATION_FAILED': 'Calculation Error',
      'GEOMETRY_DEPTH_INTERSECTION_FAILED': 'Depth Intersection Failed',
      'MEASUREMENT_INVALID_CAMERA': 'Camera Data Invalid',
      'MEASUREMENT_NO_DEPTH_DATA': 'Depth Data Unavailable',
      'MEASUREMENT_CALCULATION_FAILED': 'Measurement Failed',
      'STORAGE_SAVE_FAILED': 'Save Failed',
      'STORAGE_LOAD_FAILED': 'Load Failed',
      'STORAGE_CORRUPTED': 'Data Corrupted',
      'UI_RENDER_FAILED': 'Display Error',
      'SYSTEM_MEMORY_LOW': 'Low Memory',
      'SYSTEM_RESOURCE_UNAVAILABLE': 'Resource Unavailable',
    };

    return codeTitles[error.code] || this.getSeverityTitle(error.severity);
  }

  private getSeverityTitle(severity: ErrorSeverity): string {
    switch (severity) {
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

  getUserFriendlyMessage(error: AppError): string {
    // Provide context-specific user-friendly messages
    const codeMessages: Record<string, string> = {
      'NETWORK_TIMEOUT': 'The request took too long. Please check your internet connection and try again.',
      'NETWORK_UNREACHABLE': 'Unable to connect to the server. Please check your internet connection.',
      'API_RATE_LIMITED': 'Too many requests. Please wait a moment before trying again.',
      'API_UNAUTHORIZED': 'Authentication failed. Please check your API key settings.',
      'MODEL_LOAD_FAILED': 'Failed to load the depth estimation model. Please restart the application.',
      'MODEL_INFERENCE_FAILED': 'Depth estimation failed. Try generating the depth map again.',
      'MODEL_MEMORY_ERROR': 'Not enough memory available. Try closing other applications or reducing cache size.',
      'GEOMETRY_INVALID_POINT': 'Invalid measurement point selected. Please click on a visible object.',
      'GEOMETRY_CALCULATION_FAILED': 'Measurement calculation failed. Try selecting different points.',
      'GEOMETRY_DEPTH_INTERSECTION_FAILED': 'Could not determine depth at this location. Try a different point.',
      'MEASUREMENT_INVALID_CAMERA': 'Camera parameters are invalid. Please reload the Street View.',
      'MEASUREMENT_NO_DEPTH_DATA': 'Depth data is not available. Please generate a depth map first.',
      'MEASUREMENT_CALCULATION_FAILED': 'Unable to calculate measurement. Ensure depth map is generated and points are valid.',
      'STORAGE_SAVE_FAILED': 'Failed to save data. Please check available disk space.',
      'STORAGE_LOAD_FAILED': 'Failed to load saved data. The file may be corrupted.',
      'STORAGE_CORRUPTED': 'Saved data appears corrupted. Some data may be lost.',
      'UI_RENDER_FAILED': 'Display error occurred. The interface may not update correctly.',
      'SYSTEM_MEMORY_LOW': 'System memory is low. Consider closing other applications.',
      'SYSTEM_RESOURCE_UNAVAILABLE': 'A required system resource is unavailable. Please try again later.',
    };

    return codeMessages[error.code] || error.userFriendlyMessage || error.message || 'An unexpected error occurred.';
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
    // Send to Electron main process for file-based logging
    if (typeof window !== 'undefined' && window.electronAPI?.invoke) {
      window.electronAPI.invoke('log-error', logEntry).catch(err => {
        console.warn('[ErrorHandler] Failed to log to Electron main process:', err);
        // Fallback to localStorage
        this.saveToLocalStorage(logEntry);
      });
    } else {
      // Fallback to localStorage when Electron is not available
      this.saveToLocalStorage(logEntry);
    }
  }

  private saveToLocalStorage(logEntry: any): void {
    try {
      const existingLogs = JSON.parse(localStorage.getItem('errorLogs') || '[]');
      existingLogs.push(logEntry);
      
      // Keep only last 100 entries
      if (existingLogs.length > 100) {
        existingLogs.splice(0, existingLogs.length - 100);
      }
      
      localStorage.setItem('errorLogs', JSON.stringify(existingLogs));
    } catch (e) {
      console.warn('[ErrorHandler] Failed to store error log:', e);
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
