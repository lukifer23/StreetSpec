/**
 * Input validation and sanitization utilities
 * Used for validating user inputs and IPC payloads
 */

export interface ValidationResult<T> {
  valid: boolean;
  value?: T;
  error?: string;
}

/**
 * Validates a string input
 */
export function validateString(
  input: unknown,
  options: {
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    required?: boolean;
    trim?: boolean;
  } = {}
): ValidationResult<string> {
  const {
    minLength = 0,
    maxLength = 10000,
    pattern,
    required = false,
    trim = false
  } = options;

  if (input === null || input === undefined) {
    if (required) {
      return { valid: false, error: 'String is required' };
    }
    return { valid: true, value: '' };
  }

  if (typeof input !== 'string') {
    return { valid: false, error: 'Value must be a string' };
  }

  let processed = input;
  if (trim) {
    processed = processed.trim();
  }

  // Remove control characters except newlines and tabs
  processed = processed.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

  if (processed.length < minLength) {
    return { valid: false, error: `String must be at least ${minLength} characters` };
  }

  if (processed.length > maxLength) {
    return { valid: false, error: `String must be at most ${maxLength} characters` };
  }

  if (pattern && !pattern.test(processed)) {
    return { valid: false, error: 'String does not match required pattern' };
  }

  return { valid: true, value: processed };
}

/**
 * Validates a number input
 */
export function validateNumber(
  input: unknown,
  options: {
    min?: number;
    max?: number;
    integer?: boolean;
    required?: boolean;
  } = {}
): ValidationResult<number> {
  const { min, max, integer = false, required = false } = options;

  if (input === null || input === undefined) {
    if (required) {
      return { valid: false, error: 'Number is required' };
    }
    return { valid: false, error: 'Number is missing' };
  }

  if (typeof input !== 'number') {
    return { valid: false, error: 'Value must be a number' };
  }

  if (!Number.isFinite(input)) {
    return { valid: false, error: 'Number must be finite' };
  }

  if (integer && !Number.isInteger(input)) {
    return { valid: false, error: 'Number must be an integer' };
  }

  if (min !== undefined && input < min) {
    return { valid: false, error: `Number must be at least ${min}` };
  }

  if (max !== undefined && input > max) {
    return { valid: false, error: `Number must be at most ${max}` };
  }

  return { valid: true, value: input };
}

/**
 * Validates an array input
 */
export function validateArray<T>(
  input: unknown,
  options: {
    minLength?: number;
    maxLength?: number;
    itemValidator?: (item: unknown) => ValidationResult<T>;
    required?: boolean;
  } = {}
): ValidationResult<T[]> {
  const {
    minLength = 0,
    maxLength = 10000,
    itemValidator,
    required = false
  } = options;

  if (input === null || input === undefined) {
    if (required) {
      return { valid: false, error: 'Array is required' };
    }
    return { valid: true, value: [] };
  }

  if (!Array.isArray(input)) {
    return { valid: false, error: 'Value must be an array' };
  }

  if (input.length < minLength) {
    return { valid: false, error: `Array must have at least ${minLength} items` };
  }

  if (input.length > maxLength) {
    return { valid: false, error: `Array must have at most ${maxLength} items` };
  }

  if (itemValidator) {
    const validatedItems: T[] = [];
    for (let i = 0; i < input.length; i++) {
      const itemResult = itemValidator(input[i]);
      if (!itemResult.valid) {
        return { valid: false, error: `Item at index ${i}: ${itemResult.error}` };
      }
      validatedItems.push(itemResult.value!);
    }
    return { valid: true, value: validatedItems };
  }

  return { valid: true, value: input as T[] };
}

/**
 * Validates an object input
 */
export function validateObject<T extends Record<string, unknown>>(
  input: unknown,
  options: {
    schema?: Record<string, (value: unknown) => ValidationResult<unknown>>;
    maxKeys?: number;
    required?: boolean;
  } = {}
): ValidationResult<T> {
  const { schema, maxKeys = 1000, required = false } = options;

  if (input === null || input === undefined) {
    if (required) {
      return { valid: false, error: 'Object is required' };
    }
    return { valid: true, value: {} as T };
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, error: 'Value must be an object' };
  }

  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj);

  if (keys.length > maxKeys) {
    return { valid: false, error: `Object must have at most ${maxKeys} keys` };
  }

  if (schema) {
    const validated: Record<string, unknown> = {};
    for (const [key, validator] of Object.entries(schema)) {
      const keyResult = validateString(key, { maxLength: 200 });
      if (!keyResult.valid) {
        return { valid: false, error: `Invalid key: ${key}` };
      }

      const value = obj[key];
      const valueResult = validator(value);
      if (!valueResult.valid) {
        return { valid: false, error: `Invalid value for key "${key}": ${valueResult.error}` };
      }
      validated[key] = valueResult.value;
    }
    return { valid: true, value: validated as T };
  }

  return { valid: true, value: obj as T };
}

/**
 * Sanitizes a string by removing dangerous characters
 */
export function sanitizeString(input: string, maxLength: number = 10000): string {
  if (typeof input !== 'string') return '';
  if (input.length > maxLength) return input.substring(0, maxLength);
  return input.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Deep sanitizes an object structure
 */
export function sanitizeObject(input: unknown, maxDepth: number = 10): unknown {
  if (maxDepth <= 0) return null;
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') return sanitizeString(input);
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input === 'boolean') return input;
  if (Array.isArray(input)) {
    return input.slice(0, 1000).map(item => sanitizeObject(item, maxDepth - 1));
  }
  if (typeof input === 'object') {
    const sanitized: Record<string, unknown> = {};
    const entries = Object.entries(input).slice(0, 100);
    for (const [key, value] of entries) {
      const sanitizedKey = sanitizeString(key, 200);
      if (sanitizedKey) {
        sanitized[sanitizedKey] = sanitizeObject(value, maxDepth - 1);
      }
    }
    return sanitized;
  }
  return null;
}

