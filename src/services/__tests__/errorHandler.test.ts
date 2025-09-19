import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { errorHandler } from '../errorHandler';
import { createError, ErrorCategory, ErrorSeverity } from '../../types/common';

describe('ErrorHandlerService', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    errorHandler.clearErrorLog();
  });

  afterEach(() => {
    errorHandler.clearErrorLog();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it.each([ErrorSeverity.HIGH, ErrorSeverity.CRITICAL])(
    'shows user error for %s severity',
    async (severity) => {
      const showUserErrorSpy = jest
        .spyOn(errorHandler, 'showUserError')
        .mockImplementation(() => undefined);

      const error = createError(
        'SYSTEM_UNKNOWN',
        'Test error message',
        'Friendly message',
        severity,
        ErrorCategory.SYSTEM,
        undefined,
        false
      );

      await errorHandler.handleError(error);

      expect(showUserErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ severity })
      );
    }
  );
});
