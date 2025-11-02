import 'fake-indexeddb/auto';
import 'core-js/stable/structured-clone'; // Add this line
import '@testing-library/jest-dom';

// Mock Electron APIs for testing
Object.defineProperty(window, 'electronAPI', {
  value: {
    invoke: jest.fn(),
    on: jest.fn(),
    removeListener: jest.fn(),
  },
  writable: true,
});

// Mock Google Maps API
Object.defineProperty(window, 'google', {
  value: {
    maps: {
      Map: jest.fn(),
      StreetViewPanorama: jest.fn(),
      places: {
        PlacesService: jest.fn(),
        Autocomplete: jest.fn(),
      },
    },
  },
  writable: true,
});

// Mock import.meta for Jest (Vite environment variables)
(global as any).import = {
  meta: {
    env: {
      DEV: false,
      PROD: true,
      VITE_GOOGLE_MAPS_API_KEY: 'test-api-key',
    },
  },
};

// Suppress console warnings during tests
const originalWarn = console.warn;
beforeAll(() => {
  console.warn = (...args: unknown[]) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('componentWillReceiveProps has been renamed')
    ) {
      return;
    }
    originalWarn.call(console, ...args);
  };
});

afterAll(() => {
  console.warn = originalWarn;
});
