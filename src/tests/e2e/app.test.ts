import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { execSync } from 'child_process';
import { join } from 'path';

test.describe('Street Spec Desktop IPC E2E Tests', () => {
  test.describe.configure({ mode: 'serial' });
  let app: ElectronApplication;
  let mainWindow: Page;
  const profile = mkdtempSync(join(tmpdir(), 'streetspec-e2e-'));

  const packagedExecutable = process.env.STREETSPEC_PACKAGED_EXECUTABLE;
  const launch = async () => {
    app = await electron.launch({
      executablePath: packagedExecutable,
      args: [...(packagedExecutable ? [] : [join(__dirname, '../../../dist-electron/main.js')]), `--user-data-dir=${profile}`],
      env: { ...process.env, NODE_ENV: 'test', VITE_DEV_SERVER_URL: '' },
    });
    mainWindow = await app.firstWindow();
    await mainWindow.waitForURL('**/dist/index.html');
    await mainWindow.waitForLoadState('domcontentloaded');
    await expect(mainWindow.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  };

  test.beforeAll(async () => {
    if (!packagedExecutable) execSync('npm run build:vite', { stdio: 'inherit' });
    await launch();
  });

  test.afterAll(async () => {
    await app?.close();
    rmSync(profile, { recursive: true, force: true });
  });

  test('renders the application without a renderer crash', async () => {
    await expect(mainWindow.locator('#root')).not.toBeEmpty();
    await expect(mainWindow.getByText('Measurement Tool Error', { exact: true })).toHaveCount(0);
    expect(app.windows()).toHaveLength(1);
  });

  test.describe('IPC invoke API', () => {
    test('should retrieve default settings', async () => {
      const settings = await mainWindow.evaluate(async () => {
        return window.electronAPI.invoke('get-settings');
      });

      expect(settings).toBeDefined();
      expect(typeof settings.defaultUnit).toBe('string');
      expect(typeof settings.autoSave).toBe('boolean');
    });

    test('should update settings via IPC', async () => {
      const result = await mainWindow.evaluate(async () => {
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

    test('should persist toggled default unit after restart', async () => {
      const state = await mainWindow.evaluate(async () => {
        const initial = await window.electronAPI.invoke('get-settings');
        const toggledUnit = initial.defaultUnit === 'metric' ? 'imperial' : 'metric';
        const updated = { ...initial, defaultUnit: toggledUnit };
        await window.electronAPI.invoke('save-settings', updated);
        return { initialUnit: initial.defaultUnit, toggledUnit };
      });

      await app.close();
      await launch();

      const persistedUnit = await mainWindow.evaluate(async () => {
        const afterRestart = await window.electronAPI.invoke('get-settings');
        return afterRestart.defaultUnit;
      });

      expect(persistedUnit).toBe(state.toggledUnit);

      await mainWindow.evaluate(async (initialUnit: string) => {
        const current = await window.electronAPI.invoke('get-settings');
        const reverted = { ...current, defaultUnit: initialUnit };
        await window.electronAPI.invoke('save-settings', reverted);
        return true;
      }, state.initialUnit);
    });

    test('should persist measurements via IPC', async () => {
      const result = await mainWindow.evaluate(async () => {
        const existing = await window.electronAPI.invoke('get-measurements');
        const measurementId = crypto.randomUUID();
        const measurement = {
          id: measurementId,
          label: 'IPC Measurement',
          kind: 'distance',
          distanceMeters: 14.14,
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
      const result = await mainWindow.evaluate(async () => {
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
      const result = await mainWindow.evaluate(async () => {
        const projectId = crypto.randomUUID();
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

    test('loads the measurement controls without a Google Maps key', async () => {
      await expect(mainWindow.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
      await expect(mainWindow.getByRole('button', { name: 'Configure API Key' })).toBeVisible();
    });

    test('preserves more than 1000 measurements and rejects invalid writes atomically', async () => {
      const result = await mainWindow.evaluate(async () => {
        const items = Array.from({ length: 1001 }, (_, i) => ({
          id: crypto.randomUUID(), kind: 'distance', label: `Measurement ${i}`, unit: 'metric',
          startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 }, distanceMeters: i,
          timestamp: Date.now(), metadata: { note: 'x'.repeat(12000) },
        }));
        const saved = await window.electronAPI.invoke('save-measurements', items);
        const read = await window.electronAPI.invoke('get-measurements');
        const rejected = await window.electronAPI.invoke('save-measurements', [{ ...items[0], distanceMeters: -1 }]);
        const afterRejected = await window.electronAPI.invoke('get-measurements');
        return { saved, count: read.length, noteLength: read[1000]?.metadata.note.length, rejected, remaining: afterRejected.length };
      });
      expect(result).toEqual({ saved: true, count: 1001, noteLength: 12000, rejected: false, remaining: 1001 });
    });

    test('startup restores the full persisted workspace without autosaving an empty or truncated list', async () => {
      await app.close();
      await launch();
      await expect(mainWindow.getByText(/^Measurement 0:/).first()).toBeVisible();
      const restored = await mainWindow.evaluate(async () => {
        const measurements = await window.electronAPI.invoke('get-measurements');
        return { count: measurements.length, noteLength: measurements[0].metadata.note.length };
      });
      expect(restored).toEqual({ count: 1001, noteLength: 12000 });
    });

    test('runs the bundled ONNX model through the real preload and main process', async () => {
      const pixels = Buffer.alloc(640 * 360 * 3);
      for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 31 + Math.floor(i / 1920)) % 256;
      const png = await sharp(pixels, { raw: { width: 640, height: 360, channels: 3 } }).png().toBuffer();
      const result = await mainWindow.evaluate(async (url) => {
        const depth = await window.electronAPI.invoke('infer-depth', url);
        return depth && { width: depth.width, height: depth.height, count: depth.data.length,
          finite: depth.data.every((n: number) => Number.isFinite(n) && n >= 0 && n <= 80), transform: depth.transform };
      }, `data:image/png;base64,${png.toString('base64')}`);
      expect(result).toMatchObject({ width: 518, height: 518, count: 518 * 518, finite: true });
      expect(result.transform.originalWidth).toBe(640);
      expect(result.transform.originalHeight).toBe(360);
      expect(result.transform.offsetY).toBeGreaterThan(0);
    });

    test('settings and projects remain usable offline', async () => {
      await mainWindow.screenshot({ path: 'test-results/01-offline-workspace.png' });
      await mainWindow.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(mainWindow.getByLabel('Google Maps API Key')).toBeVisible();
      await mainWindow.screenshot({ path: 'test-results/02-settings.png' });
      await mainWindow.getByRole('button', { name: 'Cancel', exact: true }).click();
      await mainWindow.getByRole('button', { name: 'Projects', exact: true }).click();
      await mainWindow.getByPlaceholder('New project name').fill('Audit project');
      await mainWindow.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(mainWindow.getByText('Audit project', { exact: true })).toBeVisible();
      await mainWindow.screenshot({ path: 'test-results/03-projects.png' });
      await mainWindow.getByRole('button', { name: 'Close', exact: true }).click();
    });

    test('should reject invalid invoke channels', async () => {
      const result = await mainWindow.evaluate(async () => {
        try {
          await window.electronAPI.invoke('invalid-channel');
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

