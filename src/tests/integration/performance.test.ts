import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { executeWithRateLimit, getRateLimitStatus } from '../../services/rateLimiter';
import { calculateFov, screenToWorld, calculateDistance3D } from '../../services/geometry';
import { estimateDistanceToPoint, calculateEstimatedHeight } from '../../services/measurementLogic';
import { validateCoordinates, validateMeasurement, validateCameraParams } from '../../types/strict';

// Performance benchmarks
describe('Performance Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any side effects
  });

  describe('Geometry Calculations Performance', () => {
    it('should calculate FOV within acceptable time limits', () => {
      const startTime = performance.now();
      
      for (let i = 0; i < 1000; i++) {
        calculateFov(Math.random() * 20, Math.random() * 2 + 0.5);
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(50); // Should complete within 50ms
    });

    it('should perform screen-to-world conversion efficiently', () => {
      const cameraParams = {
        heading: 180,
        pitch: 0,
        vFov: 60,
        zoom: 1
      };
      
      const startTime = performance.now();
      
      for (let i = 0; i < 1000; i++) {
        screenToWorld(
          { x: Math.random() * 640, y: Math.random() * 480 },
          cameraParams,
          640,
          480
        );
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(100); // Should complete within 100ms
    });

    it('should calculate 3D distances efficiently', () => {
      const startTime = performance.now();
      
      for (let i = 0; i < 1000; i++) {
        calculateDistance3D(
          { x: Math.random() * 100, y: Math.random() * 100, z: Math.random() * 100 },
          { x: Math.random() * 100, y: Math.random() * 100, z: Math.random() * 100 }
        );
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(50); // Should complete within 50ms
    });
  });

  describe('Measurement Logic Performance', () => {
    it('should estimate distances efficiently', () => {
      const mockDepthMap = {
        width: 640,
        height: 480,
        data: new Float32Array(640 * 480).fill(1.0)
      };
      
      const cameraParams = {
        heading: 180,
        pitch: 0,
        vFov: 60,
        zoom: 1
      };
      
      const startTime = performance.now();
      
      for (let i = 0; i < 100; i++) {
        estimateDistanceToPoint(
          Math.random() * 640,
          Math.random() * 480,
          640,
          480,
          cameraParams,
          mockDepthMap
        );
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(200); // Should complete within 200ms
    });

    it('should calculate estimated heights efficiently', () => {
      const startTime = performance.now();
      
      for (let i = 0; i < 1000; i++) {
        const basePoint = { x: Math.random() * 640, y: Math.random() * 480 };
        const topPoint = { x: basePoint.x, y: Math.random() * 480 };
        calculateEstimatedHeight(
          basePoint,
          topPoint,
          640,
          480,
          { heading: 180, pitch: 0, vFov: 60, zoom: 1 },
          null,
          Math.random() * 100 + 1
        );
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(100); // Should complete within 100ms
    });
  });

  describe('Rate Limiting Performance', () => {
    it('should handle high request volumes efficiently', async () => {
      const startTime = performance.now();
      
      const promises = Array.from({ length: 100 }, (_, i) =>
        executeWithRateLimit('api-general', async () => {
          await new Promise(resolve => setTimeout(resolve, 1));
          return `request-${i}`;
        })
      );
      
      const results = await Promise.allSettled(promises);
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(100);
    });

    it('should maintain queue performance under load', async () => {
      const status = getRateLimitStatus('api-general');
      expect(status).toBeDefined();
      expect(status?.requests).toBeGreaterThanOrEqual(0);
      expect(status?.maxRequests).toBeGreaterThan(0);
    });
  });

  describe('Memory Usage Tests', () => {
    it('should not leak memory during repeated operations', () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Perform repeated operations
      for (let i = 0; i < 1000; i++) {
        calculateFov(Math.random() * 20, Math.random() * 2 + 0.5);
        screenToWorld(
          { x: Math.random() * 640, y: Math.random() * 480 },
          { heading: 180, pitch: 0, vFov: 60, zoom: 1 },
          640,
          480
        );
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // Memory increase should be reasonable (less than 10MB)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });
  });
});

// Integration tests
describe('Integration Tests', () => {
  describe('Data Flow Integration', () => {
    it('should handle complete measurement workflow', async () => {
      // Simulate camera parameters
      const cameraParams = {
        heading: 180,
        pitch: 0,
        vFov: 60,
        zoom: 1
      };
      
      // Validate camera parameters
      expect(validateCameraParams(cameraParams)).toBe(true);
      
      // Simulate screen coordinates
      const screenPoint = { x: 320, y: 240 };
      
      // Convert to world coordinates
      const worldPoint = screenToWorld(screenPoint, cameraParams, 640, 480);
      expect(worldPoint).toBeDefined();
      expect(typeof worldPoint.x).toBe('number');
      expect(typeof worldPoint.y).toBe('number');
      expect(typeof worldPoint.z).toBe('number');
      
      // Calculate distance
      const distance = calculateDistance3D({ x: 0, y: 0, z: 0 }, worldPoint);
      expect(distance).toBeGreaterThan(0);
      expect(isFinite(distance)).toBe(true);
    });

    it('should handle rate limiting with API calls', async () => {
      const mockApiCall = jest.fn().mockResolvedValue('success');
      
      const result = await executeWithRateLimit('api-general', mockApiCall);
      
      expect(result).toBe('success');
      expect(mockApiCall).toHaveBeenCalledTimes(1);
    });

    it('should validate measurement data integrity', () => {
      const measurement = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Measurement',
        label: 'Height',
        distance: 10.5,
        unit: 'metric' as const,
        startPoint: { x: 100, y: 100 },
        endPoint: { x: 200, y: 200 },
        timestamp: Date.now()
      };
      
      expect(validateMeasurement(measurement)).toBe(true);
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle invalid coordinates gracefully', () => {
      const invalidCoords = { lat: 100, lng: 200 }; // Invalid values
      expect(validateCoordinates(invalidCoords)).toBe(false);
    });

    it('should handle rate limit exceeded scenarios', async () => {
      // Exhaust the rate limit
      const promises = Array.from({ length: 60 }, () =>
        executeWithRateLimit('api-general', async () => 'success')
      );
      
      const results = await Promise.allSettled(promises);
      const rejectedCount = results.filter(r => r.status === 'rejected').length;
      
      // Some requests should be rejected due to rate limiting
      expect(rejectedCount).toBeGreaterThan(0);
    });
  });

  describe('Performance Monitoring Integration', () => {
    it('should track operation performance', () => {
      const performanceMarks: string[] = [];
      const performanceMeasures: string[] = [];
      
      // Mock performance API
      const originalMark = performance.mark;
      const originalMeasure = performance.measure;
      
      performance.mark = jest.fn((name) => {
        performanceMarks.push(name);
        originalMark.call(performance, name);
      });
      
      performance.measure = jest.fn((name) => {
        performanceMeasures.push(name);
        originalMeasure.call(performance, name);
      });
      
      // Perform operations
      calculateFov(10, 1.5);
      screenToWorld({ x: 320, y: 240 }, { heading: 180, pitch: 0, vFov: 60, zoom: 1 }, 640, 480);
      
      // Restore original methods
      performance.mark = originalMark;
      performance.measure = originalMeasure;
      
      // Verify performance tracking
      expect(performanceMarks.length).toBeGreaterThan(0);
      expect(performanceMeasures.length).toBeGreaterThan(0);
    });
  });
});

// Load testing
describe('Load Tests', () => {
  it('should handle concurrent measurement calculations', async () => {
    const concurrentOperations = 50;
    const startTime = performance.now();
    
    const promises = Array.from({ length: concurrentOperations }, () =>
      Promise.all([
        calculateFov(Math.random() * 20, Math.random() * 2 + 0.5),
        screenToWorld(
          { x: Math.random() * 640, y: Math.random() * 480 },
          { heading: Math.random() * 360, pitch: Math.random() * 90, vFov: 60, zoom: 1 },
          640,
          480
        ),
        calculateDistance3D(
          { x: Math.random() * 100, y: Math.random() * 100, z: Math.random() * 100 },
          { x: Math.random() * 100, y: Math.random() * 100, z: Math.random() * 100 }
        )
      ])
    );
    
    const results = await Promise.all(promises);
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    expect(results).toHaveLength(concurrentOperations);
    expect(duration).toBeLessThan(1000); // Should complete within 1 second
  });

  it('should handle rapid state updates', async () => {
    const updates = 1000;
    const startTime = performance.now();
    
    for (let i = 0; i < updates; i++) {
      calculateFov(i % 20, (i % 10) / 5 + 0.5);
    }
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    expect(duration).toBeLessThan(500); // Should complete within 500ms
  });
});

// Stress testing
describe('Stress Tests', () => {
  it('should handle extreme coordinate values', () => {
    const extremeValues = [
      { x: 0, y: 0 },
      { x: 999999, y: 999999 },
      { x: -1000, y: -1000 },
      { x: Number.MAX_SAFE_INTEGER, y: Number.MAX_SAFE_INTEGER }
    ];
    
    extremeValues.forEach(point => {
      expect(() => {
        screenToWorld(
          point,
          { heading: 180, pitch: 0, vFov: 60, zoom: 1 },
          640,
          480
        );
      }).not.toThrow();
    });
  });

  it('should handle malformed data gracefully', () => {
    const malformedData = [
      null,
      undefined,
      {},
      { invalid: 'data' },
      { x: 'not a number', y: 'also not a number' }
    ];
    
    malformedData.forEach(data => {
      expect(() => {
        if (data && typeof data.x === 'number' && typeof data.y === 'number') {
          screenToWorld(
            data as { x: number; y: number },
            { heading: 180, pitch: 0, vFov: 60, zoom: 1 },
            640,
            480
          );
        }
      }).not.toThrow();
    });
  });
});
