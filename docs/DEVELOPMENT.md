# Street Spec Desktop - Development Guide

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run validation (type check + lint + tests)
npm run validate
```

## Code Organization

### Import Patterns

Use centralized index files for cleaner imports:

```typescript
// Services
import { generateDepthMap, getCachedDepthMap } from '../services';
import { calibrationManager } from '../services';

// Utils
import { createAppError, validatePoint } from '../utils';
import { UnifiedCache } from '../utils';

// Types
import type { Measurement, CameraParams, AppError } from '../types';
import { ERROR_CODES, ErrorSeverity } from '../types';
```

### File Naming Conventions

- **Components**: PascalCase (e.g., `MeasurementTool.tsx`)
- **Services**: camelCase (e.g., `depthGeneration.ts`)
- **Utils**: camelCase (e.g., `errorUtils.ts`)
- **Types**: camelCase (e.g., `common.ts`)
- **Stores**: camelCase (e.g., `rootStore.ts`)
- **Tests**: `.test.ts` or `.test.tsx` suffix

### Directory Structure

```
src/
├── components/          # React UI components
│   ├── *.tsx           # Component files
│   └── *.module.css    # Component styles
├── services/            # Business logic
│   ├── index.ts        # Centralized exports
│   └── *.ts            # Service implementations
├── utils/               # Utility functions
│   ├── index.ts        # Centralized exports
│   └── *.ts            # Utility implementations
├── types/               # TypeScript types
│   ├── index.ts        # Centralized exports
│   └── *.ts            # Type definitions
├── stores/              # Zustand stores
├── hooks/               # React hooks
└── tests/               # Test files
```

## Coding Standards

### TypeScript

- Use strict type checking (`tsconfig.strict.json`)
- Prefer type-safe patterns (discriminated unions, branded types)
- Avoid `any` - use `unknown` and type guards instead
- Use const assertions for literal types

### Error Handling

Always use centralized error utilities:

```typescript
import { createAppError, errorToAppError } from '../utils/errorUtils';

// Create new error
throw createAppError(
  'NETWORK_TIMEOUT',
  'Request timed out',
  'The request took too long. Please try again.',
  ErrorSeverity.HIGH,
  ErrorCategory.NETWORK
);

// Convert caught error
try {
  // ...
} catch (err) {
  const appError = errorToAppError(err, 'SYSTEM_UNKNOWN');
  await errorHandler.handleError(appError, { component: 'MyComponent' });
}
```

### Validation

Use Zod schemas for runtime validation:

```typescript
import { validateIPCInvoke, validatePoint } from '../utils/validation';

// IPC validation
const payload = validateIPCInvoke('fetch-depth-data', data);

// Point validation
const point = validatePoint({ x: 100, y: 200 });
```

### Caching

Use UnifiedCache for consistent caching:

```typescript
import { UnifiedCache, cacheRegistry } from '../utils/cacheManager';

const myCache = new UnifiedCache<string>({
  name: 'my-cache',
  maxSize: 100,
  evictionStrategy: 'lru'
});

cacheRegistry.register('my-cache', myCache);
```

### State Management

Use Zustand with Immer for state:

```typescript
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

interface MyState {
  value: number;
  setValue: (value: number) => void;
}

export const useMyStore = create<MyState>()(
  immer((set) => ({
    value: 0,
    setValue: (value) => set((state) => { state.value = value; })
  }))
);
```

## Testing

### Unit Tests

```typescript
import { describe, it, expect } from '@jest/globals';
import { myFunction } from '../services/myService';

describe('myService', () => {
  it('should do something', () => {
    const result = myFunction(input);
    expect(result).toBe(expected);
  });
});
```

### Component Tests

```typescript
import { render, screen } from '@testing-library/react';
import { MyComponent } from '../components/MyComponent';

describe('MyComponent', () => {
  it('should render', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

### Integration Tests

```typescript
import { describe, it, expect } from '@jest/globals';
import { generateDepthMap } from '../services';

describe('Depth Generation Integration', () => {
  it('should generate depth map end-to-end', async () => {
    const result = await generateDepthMap(params, apiKey, deps);
    expect(result.depthMap).toBeDefined();
  });
});
```

## Common Patterns

### Service Pattern

```typescript
/**
 * Service description
 */
export class MyService {
  private static instance: MyService | null = null;

  static getInstance(): MyService {
    if (!MyService.instance) {
      MyService.instance = new MyService();
    }
    return MyService.instance;
  }

  async doSomething(): Promise<Result> {
    // Implementation
  }
}

export const myService = MyService.getInstance();
```

### Utility Function Pattern

```typescript
/**
 * Function description
 * @param param - Parameter description
 * @returns Return description
 */
export function myUtility(param: Param): Return {
  // Implementation
  return result;
}
```

### Component Pattern

```typescript
import { useState, useCallback } from 'react';
import type { Props } from '../types';

/**
 * Component description
 */
export function MyComponent({ prop1, prop2 }: Props) {
  const [state, setState] = useState<StateType>(initial);

  const handleAction = useCallback(() => {
    // Handler implementation
  }, [dependencies]);

  return (
    <div>
      {/* JSX */}
    </div>
  );
}
```

## Git Workflow

1. Create feature branch: `git checkout -b feature/my-feature`
2. Make changes
3. Run validation: `npm run validate`
4. Commit: `git commit -m "feat: add my feature"`
5. Push: `git push origin feature/my-feature`
6. Create pull request

### Commit Message Format

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting)
- `refactor:` Code refactoring
- `test:` Test additions/changes
- `chore:` Build process or auxiliary tool changes

## Debugging

### Development Mode

```bash
npm run dev
```

Opens DevTools automatically. Use React DevTools and Redux DevTools extensions.

### Type Checking

```bash
npm run typecheck:strict
```

### Linting

```bash
npm run lint
npm run lint:fix  # Auto-fix issues
```

### Testing

```bash
npm run test:watch  # Watch mode
npm run test:coverage  # Coverage report
```

## Performance Profiling

### React Profiler

Use React DevTools Profiler to identify slow components.

### Chrome DevTools

Use Performance tab to profile rendering and JavaScript execution.

### Memory Profiling

Use Memory tab to identify memory leaks. Check for:
- Unclosed event listeners
- Cached data growing unbounded
- Retained references to large objects

## Troubleshooting

### Common Issues

**Type errors**: Run `npm run typecheck:strict` to see detailed errors

**Import errors**: Ensure index files are up to date

**Cache issues**: Clear cache with `npm run clean` and rebuild

**Test failures**: Run tests individually to isolate issues

## Resources

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Technical architecture
- [API.md](./API.md) - API documentation
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contribution guidelines
- [roadmap.md](./roadmap.md) - Development roadmap


