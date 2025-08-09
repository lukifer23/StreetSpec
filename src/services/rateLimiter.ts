import { createError, ErrorSeverity, ErrorCategory } from '../types/common';

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  retryDelay: number;
  maxRetries: number;
  backoffMultiplier: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
}

interface RateLimitState {
  requests: number;
  lastReset: number;
  failures: number;
  lastFailure: number;
  circuitOpen: boolean;
  circuitOpenTime: number;
}

interface RequestOptions {
  priority?: 'low' | 'normal' | 'high';
  timeout?: number;
  retryOnFailure?: boolean;
  circuitBreaker?: boolean;
}

class RateLimiter {
  private configs: Map<string, RateLimitConfig>;
  private states: Map<string, RateLimitState>;
  private requestQueue: Array<{
    id: string;
    execute: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
    priority: number;
    timestamp: number;
  }>;
  private isProcessing: boolean = false;

  constructor() {
    this.configs = new Map();
    this.states = new Map();
    this.requestQueue = [];
    this.setupDefaultConfigs();
  }

  private setupDefaultConfigs(): void {
    // Google Maps API rate limits
    this.addConfig('google-maps', {
      maxRequests: 100,
      windowMs: 60000, // 1 minute
      retryDelay: 1000,
      maxRetries: 3,
      backoffMultiplier: 2,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 30000
    });

    // Depth map generation
    this.addConfig('depth-generation', {
      maxRequests: 10,
      windowMs: 60000,
      retryDelay: 2000,
      maxRetries: 2,
      backoffMultiplier: 1.5,
      circuitBreakerThreshold: 3,
      circuitBreakerTimeout: 60000
    });

    // General API calls
    this.addConfig('api-general', {
      maxRequests: 50,
      windowMs: 60000,
      retryDelay: 500,
      maxRetries: 3,
      backoffMultiplier: 2,
      circuitBreakerThreshold: 10,
      circuitBreakerTimeout: 30000
    });
  }

  addConfig(name: string, config: RateLimitConfig): void {
    this.configs.set(name, config);
    this.states.set(name, {
      requests: 0,
      lastReset: Date.now(),
      failures: 0,
      lastFailure: 0,
      circuitOpen: false,
      circuitOpenTime: 0
    });
  }

  private getPriorityValue(priority: string): number {
    switch (priority) {
      case 'high': return 3;
      case 'normal': return 2;
      case 'low': return 1;
      default: return 2;
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.requestQueue.length === 0) return;

    this.isProcessing = true;

    while (this.requestQueue.length > 0) {
      // Sort by priority and timestamp
      this.requestQueue.sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return a.timestamp - b.timestamp;
      });

      const request = this.requestQueue.shift();
      if (!request) continue;

      try {
        const result = await request.execute();
        request.resolve(result);
      } catch (error) {
        request.reject(error);
      }

      // Small delay between requests to prevent overwhelming
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    this.isProcessing = false;
  }

  async executeWithRateLimit<T>(
    name: string,
    operation: () => Promise<T>,
    options: RequestOptions = {}
  ): Promise<T> {
    const config = this.configs.get(name);
    if (!config) {
      throw createError(
        'RATE_LIMIT_CONFIG_NOT_FOUND',
        `Rate limit config not found for: ${name}`,
        `Configuration error for ${name}`,
        ErrorSeverity.HIGH,
        ErrorCategory.SYSTEM
      );
    }

    const state = this.states.get(name)!;
    const priority = this.getPriorityValue(options.priority || 'normal');

    return new Promise<T>((resolve, reject) => {
      const requestId = `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      this.requestQueue.push({
        id: requestId,
        execute: () => this.executeOperation(name, operation, config, state, options),
        resolve,
        reject,
        priority,
        timestamp: Date.now()
      });

      this.processQueue();
    });
  }

  private async executeOperation<T>(
    name: string,
    operation: () => Promise<T>,
    config: RateLimitConfig,
    state: RateLimitState,
    options: RequestOptions
  ): Promise<T> {
    // Check circuit breaker
    if (state.circuitOpen && options.circuitBreaker !== false) {
      if (Date.now() - state.circuitOpenTime < config.circuitBreakerTimeout) {
        throw createError(
          'CIRCUIT_BREAKER_OPEN',
          `Circuit breaker is open for ${name}`,
          `Service temporarily unavailable. Please try again later.`,
          ErrorSeverity.MEDIUM,
          ErrorCategory.NETWORK
        );
      } else {
        // Reset circuit breaker
        state.circuitOpen = false;
        state.failures = 0;
      }
    }

    // Check rate limit
    const now = Date.now();
    if (now - state.lastReset >= config.windowMs) {
      state.requests = 0;
      state.lastReset = now;
    }

    if (state.requests >= config.maxRequests) {
      const waitTime = config.windowMs - (now - state.lastReset);
      throw createError(
        'RATE_LIMIT_EXCEEDED',
        `Rate limit exceeded for ${name}. Try again in ${Math.ceil(waitTime / 1000)} seconds.`,
        `Too many requests. Please wait a moment and try again.`,
        ErrorSeverity.MEDIUM,
        ErrorCategory.NETWORK,
        { waitTime }
      );
    }

    state.requests++;

    // Execute with retry logic
    let lastError: any;
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const timeout = options.timeout || 30000;
        const result = await Promise.race([
          operation(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), timeout)
          )
        ]);

        // Success - reset failure count
        state.failures = 0;
        return result;

      } catch (error) {
        lastError = error;
        state.failures++;
        state.lastFailure = Date.now();

        // Check if circuit breaker should open
        if (state.failures >= config.circuitBreakerThreshold && options.circuitBreaker !== false) {
          state.circuitOpen = true;
          state.circuitOpenTime = Date.now();
          throw createError(
            'CIRCUIT_BREAKER_TRIGGERED',
            `Circuit breaker triggered for ${name} after ${state.failures} failures`,
            `Service is experiencing issues. Please try again later.`,
            ErrorSeverity.HIGH,
            ErrorCategory.NETWORK
          );
        }

        // Don't retry on last attempt
        if (attempt === config.maxRetries) {
          break;
        }

        // Calculate backoff delay
        const delay = config.retryDelay * Math.pow(config.backoffMultiplier, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  // Batch operations for efficiency
  async executeBatch<T>(
    name: string,
    operations: Array<() => Promise<T>>,
    options: RequestOptions = {}
  ): Promise<T[]> {
    const results: T[] = [];
    const errors: any[] = [];

    // Execute operations in parallel with rate limiting
    const promises = operations.map(async (operation, index) => {
      try {
        const result = await this.executeWithRateLimit(name, operation, options);
        results[index] = result;
        return result;
      } catch (error) {
        errors[index] = error;
        throw error;
      }
    });

    try {
      await Promise.allSettled(promises);
    } catch (error) {
      // Continue processing other operations
    }

    if (errors.length > 0) {
      console.warn(`Batch operation completed with ${errors.length} errors`);
    }

    return results;
  }

  // Get current rate limit status
  getStatus(name: string): {
    requests: number;
    maxRequests: number;
    windowMs: number;
    timeUntilReset: number;
    circuitOpen: boolean;
    failures: number;
  } | null {
    const config = this.configs.get(name);
    const state = this.states.get(name);
    
    if (!config || !state) return null;

    const now = Date.now();
    const timeUntilReset = Math.max(0, config.windowMs - (now - state.lastReset));

    return {
      requests: state.requests,
      maxRequests: config.maxRequests,
      windowMs: config.windowMs,
      timeUntilReset,
      circuitOpen: state.circuitOpen,
      failures: state.failures
    };
  }

  // Reset rate limiter state
  reset(name: string): void {
    const state = this.states.get(name);
    if (state) {
      state.requests = 0;
      state.lastReset = Date.now();
      state.failures = 0;
      state.circuitOpen = false;
      state.circuitOpenTime = 0;
    }
  }

  // Get queue status
  getQueueStatus(): {
    queueLength: number;
    isProcessing: boolean;
    averageWaitTime: number;
  } {
    const now = Date.now();
    const totalWaitTime = this.requestQueue.reduce((sum, req) => sum + (now - req.timestamp), 0);
    const averageWaitTime = this.requestQueue.length > 0 ? totalWaitTime / this.requestQueue.length : 0;

    return {
      queueLength: this.requestQueue.length,
      isProcessing: this.isProcessing,
      averageWaitTime
    };
  }

  // Clear queue
  clearQueue(): void {
    this.requestQueue.forEach(request => {
      request.reject(createError(
        'QUEUE_CLEARED',
        'Request queue was cleared',
        'Operation was cancelled',
        ErrorSeverity.LOW,
        ErrorCategory.SYSTEM
      ));
    });
    this.requestQueue = [];
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();

// Convenience functions
export const executeWithRateLimit = <T>(
  name: string,
  operation: () => Promise<T>,
  options?: RequestOptions
): Promise<T> => {
  return rateLimiter.executeWithRateLimit(name, operation, options);
};

export const executeBatch = <T>(
  name: string,
  operations: Array<() => Promise<T>>,
  options?: RequestOptions
): Promise<T[]> => {
  return rateLimiter.executeBatch(name, operations, options);
};

export const getRateLimitStatus = (name: string) => rateLimiter.getStatus(name);
export const resetRateLimit = (name: string) => rateLimiter.reset(name);
export const getQueueStatus = () => rateLimiter.getQueueStatus();
export const clearQueue = () => rateLimiter.clearQueue();
