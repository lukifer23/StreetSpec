import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { join } from 'path';

test.describe('Street Spec Desktop IPC E2E Tests', () => {
  let app: any;
  let mainWindow: any;

  test.beforeAll(async () => {
    // Build the application once before starting tests
    execSync('npm run build', { stdio: 'inherit' });

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
  });

  test.describe('IPC invoke API', () => {
    test('should retrieve default settings', async () => {
      const settings = await mainWindow.execute(async () => {
        return window.electronAPI.invoke('get-settings');
      });

      expect(settings).toBeDefined();
      expect(typeof settings.defaultUnit).toBe('string');
      expect(typeof settings.autoSave).toBe('boolean');
    });

    test('should update settings via IPC', async () => {
      const result = await mainWindow.execute(async () => {
        const current = await window.electronAPI.invoke('get-settings');
        const nextUnit = current.defaultUnit === 'metric' ? 'imperial' : 'metric';
        const updated = { ...current, defaultUnit: nextUnit };
        const saveResult = await window.electronAPI.invoke('save-settings', updated);
        const roundtrip = await window.electronAPI.invoke('get-settings');
        await window.electronAPI.invoke('save-settings', current);

        return {
          saveResult,
          nextUnit,
          roundtripUnit: roundtrip.defaultUnit
        };
      });

      expect(result.saveResult).toBe(true);
      expect(result.roundtripUnit).toBe(result.nextUnit);
    });

    test('should persist measurements via IPC', async () => {
      const result = await mainWindow.execute(async () => {
        const existing = await window.electronAPI.invoke('get-measurements');
        const measurementId = `e2e-measurement-${Date.now()}`;
        const measurement = {
          id: measurementId,
          label: 'IPC Measurement',
          startPoint: { x: 0, y: 0 },
          endPoint: { x: 10, y: 10 },
          distance: 14.14,
          unit: 'metric',
          timestamp: Date.now(),
          panoId: 'test-pano',
          cameraParams: { heading: 0, pitch: 0, zoom: 1 },
          error: ''
        };
        const updated = [...existing, measurement];
        const saveResult = await window.electronAPI.invoke('save-measurements', updated);
        const roundtrip = await window.electronAPI.invoke('get-measurements');
        await window.electronAPI.invoke('save-measurements', existing);

        return {
          saveResult,
          before: existing.length,
          after: roundtrip.length,
          containsMeasurement: roundtrip.some((item: { id: string }) => item.id === measurementId)
        };
      });

      expect(result.saveResult).toBe(true);
      expect(result.after).toBe(result.before + 1);
      expect(result.containsMeasurement).toBe(true);
    });

    test('should clear measurement data via IPC', async () => {
      const result = await mainWindow.execute(async () => {
        const existing = await window.electronAPI.invoke('get-measurements');
        const clearResult = await window.electronAPI.invoke('clear-data');
        const cleared = await window.electronAPI.invoke('get-measurements');
        await window.electronAPI.invoke('save-measurements', existing);

        return {
          clearResult,
          before: existing.length,
          after: cleared.length
        };
      });

      expect(result.clearResult).toBe(true);
      expect(result.after).toBe(0);
    });

    test('should manage projects via IPC', async () => {
      const result = await mainWindow.execute(async () => {
        const projectId = `e2e-project-${Date.now()}`;
        const project = { id: projectId, name: 'IPC Test Project', measurements: [] };
        const saveResult = await window.electronAPI.invoke('save-project', project);
        const projectsAfterSave = await window.electronAPI.invoke('get-projects');
        const existsAfterSave = Boolean(projectsAfterSave[projectId]);
        const deleteResult = await window.electronAPI.invoke('delete-project', projectId);
        const projectsAfterDelete = await window.electronAPI.invoke('get-projects');

        return {
          saveResult,
          existsAfterSave,
          deleteResult,
          existsAfterDelete: Boolean(projectsAfterDelete[projectId])
        };
      });

      expect(result.saveResult).toBe(true);
      expect(result.existsAfterSave).toBe(true);
      expect(result.deleteResult).toBe(true);
      expect(result.existsAfterDelete).toBe(false);
    });

    test('should reject invalid invoke channels', async () => {
      const result = await mainWindow.execute(() => {
        try {
          void window.electronAPI.invoke('invalid-channel');
          return { success: true };
        } catch (error: any) {
          return {
            success: false,
            message: error?.message ?? String(error)
          };
        }
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid invoke channel');
    });
  });
});
