import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { join } from 'path';

// Test configuration
test.describe('PoleCheck Desktop E2E Tests', () => {
  let app: any;
  let mainWindow: any;

  test.beforeAll(async () => {
    // Build the application
    execSync('npm run build', { stdio: 'inherit' });
    
    // Start the Electron app
    const { Application } = require('spectron');
    app = new Application({
      path: require('electron'),
      args: [join(__dirname, '../../dist-electron/main.js')],
      env: {
        NODE_ENV: 'test'
      }
    });
    
    await app.start();
    mainWindow = app.client;
  });

  test.afterAll(async () => {
    if (app && app.isRunning()) {
      await app.stop();
    }
  });

  test.describe('Application Launch', () => {
    test('should launch successfully', async () => {
      expect(app.isRunning()).toBe(true);
    });

    test('should display main window', async () => {
      const windowCount = await app.client.getWindowCount();
      expect(windowCount).toBeGreaterThan(0);
    });

    test('should load Google Maps API', async () => {
      await mainWindow.waitUntil(async () => {
        const isLoaded = await mainWindow.execute(() => {
          return typeof window.google !== 'undefined' && 
                 typeof window.google.maps !== 'undefined';
        });
        return isLoaded;
      }, { timeout: 10000 });
    });
  });

  test.describe('Core Functionality', () => {
    test('should initialize with default location', async () => {
      const defaultLocation = await mainWindow.execute(() => {
        // Access the store to get current location
        return window.electronAPI.getCurrentLocation();
      });
      
      expect(defaultLocation).toBeDefined();
      expect(defaultLocation.lat).toBeCloseTo(40.7580, 1);
      expect(defaultLocation.lng).toBeCloseTo(-73.9855, 1);
    });

    test('should handle camera parameter changes', async () => {
      const initialParams = await mainWindow.execute(() => {
        return window.electronAPI.getCameraParams();
      });
      
      expect(initialParams).toBeDefined();
      expect(initialParams.heading).toBeDefined();
      expect(initialParams.pitch).toBeDefined();
      expect(initialParams.zoom).toBeDefined();
    });

    test('should generate depth maps', async () => {
      // Trigger depth map generation
      await mainWindow.execute(() => {
        return window.electronAPI.generateDepthMap();
      });
      
      // Wait for generation to complete
      await mainWindow.waitUntil(async () => {
        const isGenerating = await mainWindow.execute(() => {
          return window.electronAPI.isGeneratingDepthMap();
        });
        return !isGenerating;
      }, { timeout: 30000 });
      
      // Check if depth map was generated
      const depthMap = await mainWindow.execute(() => {
        return window.electronAPI.getDepthMap();
      });
      
      expect(depthMap).toBeDefined();
      expect(depthMap.width).toBeGreaterThan(0);
      expect(depthMap.height).toBeGreaterThan(0);
    });
  });

  test.describe('Measurement System', () => {
    test('should create measurements', async () => {
      // Simulate measurement creation
      const measurement = await mainWindow.execute(() => {
        return window.electronAPI.createMeasurement({
          startPoint: { x: 100, y: 100 },
          endPoint: { x: 200, y: 200 },
          label: 'Test Measurement'
        });
      });
      
      expect(measurement).toBeDefined();
      expect(measurement.id).toBeDefined();
      expect(measurement.distance).toBeGreaterThan(0);
    });

    test('should calculate accurate distances', async () => {
      const measurements = await mainWindow.execute(() => {
        return window.electronAPI.getAllMeasurements();
      });
      
      measurements.forEach((measurement: any) => {
        expect(measurement.distance).toBeGreaterThan(0);
        expect(measurement.unit).toMatch(/^(metric|imperial)$/);
        expect(measurement.startPoint).toBeDefined();
        expect(measurement.endPoint).toBeDefined();
      });
    });

    test('should handle unit conversions', async () => {
      const conversion = await mainWindow.execute(() => {
        return window.electronAPI.convertUnit(10, 'metric', 'imperial');
      });
      
      expect(conversion).toBeCloseTo(32.8084, 1); // 10 meters to feet
    });
  });

  test.describe('Project Management', () => {
    test('should create projects', async () => {
      const project = await mainWindow.execute(() => {
        return window.electronAPI.createProject('Test Project');
      });
      
      expect(project).toBeDefined();
      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
    });

    test('should save and load projects', async () => {
      // Create a project with measurements
      const projectId = await mainWindow.execute(() => {
        return window.electronAPI.createProject('Save Test Project');
      });
      
      // Add a measurement
      await mainWindow.execute(() => {
        return window.electronAPI.createMeasurement({
          startPoint: { x: 150, y: 150 },
          endPoint: { x: 250, y: 250 },
          label: 'Project Measurement'
        });
      });
      
      // Save the project
      await mainWindow.execute(() => {
        return window.electronAPI.saveProject(projectId);
      });
      
      // Load the project
      const loadedProject = await mainWindow.execute(() => {
        return window.electronAPI.loadProject(projectId);
      });
      
      expect(loadedProject).toBeDefined();
      expect(loadedProject.measurements).toHaveLength(1);
    });

    test('should export data to CSV', async () => {
      const csvData = await mainWindow.execute(() => {
        return window.electronAPI.exportToCSV();
      });
      
      expect(csvData).toBeDefined();
      expect(typeof csvData).toBe('string');
      expect(csvData).toContain('Measurement,Start Point,End Point,Distance,Unit');
    });
  });

  test.describe('Settings and Configuration', () => {
    test('should load default settings', async () => {
      const settings = await mainWindow.execute(() => {
        return window.electronAPI.getSettings();
      });
      
      expect(settings).toBeDefined();
      expect(settings.defaultUnit).toMatch(/^(metric|imperial)$/);
      expect(settings.autoSave).toBeDefined();
    });

    test('should update settings', async () => {
      const newSettings = await mainWindow.execute(() => {
        return window.electronAPI.updateSettings({
          defaultUnit: 'imperial',
          autoSave: true
        });
      });
      
      expect(newSettings.defaultUnit).toBe('imperial');
      expect(newSettings.autoSave).toBe(true);
    });
  });

  test.describe('Error Handling', () => {
    test('should handle invalid coordinates gracefully', async () => {
      const result = await mainWindow.execute(() => {
        return window.electronAPI.validateCoordinates({
          lat: 100, // Invalid latitude
          lng: 200  // Invalid longitude
        });
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    test('should handle network errors', async () => {
      // Simulate network error by temporarily disabling internet
      const error = await mainWindow.execute(() => {
        return window.electronAPI.simulateNetworkError();
      });
      
      expect(error).toBeDefined();
      expect(error.type).toBe('network');
    });

    test('should recover from errors', async () => {
      // Simulate error recovery
      const recovery = await mainWindow.execute(() => {
        return window.electronAPI.simulateErrorRecovery();
      });
      
      expect(recovery.success).toBe(true);
    });
  });

  test.describe('Performance Tests', () => {
    test('should handle rapid measurements', async () => {
      const startTime = Date.now();
      
      // Create multiple measurements rapidly
      const promises = Array.from({ length: 10 }, (_, i) => 
        mainWindow.execute(() => {
          return window.electronAPI.createMeasurement({
            startPoint: { x: i * 10, y: i * 10 },
            endPoint: { x: (i + 1) * 10, y: (i + 1) * 10 },
            label: `Rapid Measurement ${i}`
          });
        })
      );
      
      const results = await Promise.all(promises);
      const endTime = Date.now();
      
      expect(results).toHaveLength(10);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    test('should maintain responsive UI during heavy operations', async () => {
      // Start a heavy operation
      const heavyOperation = mainWindow.execute(() => {
        return window.electronAPI.startHeavyOperation();
      });
      
      // Try to interact with UI while operation is running
      const uiResponsive = await mainWindow.execute(() => {
        return window.electronAPI.isUIResponsive();
      });
      
      await heavyOperation;
      
      expect(uiResponsive).toBe(true);
    });
  });

  test.describe('Memory Management', () => {
    test('should not leak memory during operations', async () => {
      const initialMemory = await mainWindow.execute(() => {
        return window.electronAPI.getMemoryUsage();
      });
      
      // Perform memory-intensive operations
      for (let i = 0; i < 10; i++) {
        await mainWindow.execute(() => {
          return window.electronAPI.performMemoryIntensiveOperation();
        });
      }
      
      const finalMemory = await mainWindow.execute(() => {
        return window.electronAPI.getMemoryUsage();
      });
      
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      
      // Memory increase should be reasonable (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });

  test.describe('Accessibility', () => {
    test('should support keyboard navigation', async () => {
      const keyboardSupport = await mainWindow.execute(() => {
        return window.electronAPI.testKeyboardNavigation();
      });
      
      expect(keyboardSupport).toBe(true);
    });

    test('should have proper ARIA labels', async () => {
      const ariaLabels = await mainWindow.execute(() => {
        return window.electronAPI.getAriaLabels();
      });
      
      expect(ariaLabels).toBeDefined();
      expect(ariaLabels.length).toBeGreaterThan(0);
    });

    test('should support screen readers', async () => {
      const screenReaderSupport = await mainWindow.execute(() => {
        return window.electronAPI.testScreenReaderSupport();
      });
      
      expect(screenReaderSupport).toBe(true);
    });
  });

  test.describe('Security', () => {
    test('should validate input data', async () => {
      const validation = await mainWindow.execute(() => {
        return window.electronAPI.validateInputData({
          malicious: '<script>alert("xss")</script>',
          coordinates: { lat: 100, lng: 200 } // Invalid
        });
      });
      
      expect(validation.valid).toBe(false);
      expect(validation.errors).toBeDefined();
    });

    test('should prevent XSS attacks', async () => {
      const xssPrevention = await mainWindow.execute(() => {
        return window.electronAPI.testXSSPrevention();
      });
      
      expect(xssPrevention).toBe(true);
    });

    test('should sanitize user input', async () => {
      const sanitized = await mainWindow.execute(() => {
        return window.electronAPI.sanitizeInput('<script>alert("xss")</script>');
      });
      
      expect(sanitized).not.toContain('<script>');
    });
  });
});
