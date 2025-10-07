import { app, BrowserWindow, ipcMain, dialog, IpcMainInvokeEvent, Event } from 'electron';
import { release } from 'node:os';
import { join, dirname } from 'node:path';
import fetch from 'node-fetch';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import * as fs from 'fs';
import Store from 'electron-store';
import { inflateSync } from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';
import { parse as parseProto } from 'protobufjs';
import { MODEL_CALIBRATIONS } from '../src/services/depthCalibration';
import type { DecodedDepthData, DepthDataFetchResult, DepthDataErrorCode, DepthPlane } from '../src/types/common';

// --- Add ESM __dirname equivalent --- 
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// --- End ESM __dirname equivalent ---

const DEFAULT_DEPTH_API_MAX_RETRIES = 5;
const DEFAULT_DEPTH_API_RETRY_DELAY_MS = 1000;

// Initialize electron-store for persistence
const store = new Store({
  defaults: {
    projects: {},
    measurements: [],
    settings: {
      defaultUnit: 'metric',
      autoSave: true,
      theme: 'light',
      language: 'en',
      measurementHistoryLimit: 1000,
      useGPU: false,
      calibrationPitchOffsetDeg: 0,
      depthScale: 1,
      depthBias: 0,
      depthApiMaxRetries: DEFAULT_DEPTH_API_MAX_RETRIES
    }
  },
  schema: {
    projects: {
      type: 'object',
      patternProperties: {
        '.*': {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            measurements: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  name: { type: 'string' },
                  startPoint: { type: 'object' },
                  endPoint: { type: 'object' },
                  distance: { type: 'number' },
                  unit: { type: 'string', enum: ['metric', 'imperial'] },
                  timestamp: { type: 'number' },
                  panoId: { type: 'string' },
                  cameraParams: { type: 'object' },
                  error: { type: 'string' }
                }
              }
            }
          }
        }
      }
    },
    measurements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          name: { type: 'string' },
          startPoint: { type: 'object' },
          endPoint: { type: 'object' },
          distance: { type: 'number' },
          unit: { type: 'string', enum: ['metric', 'imperial'] },
          timestamp: { type: 'number' },
          panoId: { type: 'string' },
          cameraParams: { type: 'object' },
          error: { type: 'string' }
        }
      }
    },
    settings: {
      type: 'object',
      properties: {
        defaultUnit: { type: 'string', enum: ['metric', 'imperial'] },
        autoSave: { type: 'boolean' },
        theme: { type: 'string', enum: ['light', 'dark', 'system'] },
        language: { type: 'string' },
        measurementHistoryLimit: { type: 'number', minimum: 1, maximum: 10000 },
        useGPU: { type: 'boolean' },
        calibrationPitchOffsetDeg: { type: 'number' },
        depthScale: { type: 'number' },
        depthBias: { type: 'number' },
        depthKernelSize: { type: 'number', enum: [3,5,7] },
        depthUseBilinear: { type: 'boolean' },
        depthEdgeRejectThreshold: { type: 'number', minimum: 0, maximum: 1 },
        autoCalibrateDepth: { type: 'boolean' },
        showDebugOverlay: { type: 'boolean' },
        depthApiMaxRetries: { type: 'number', minimum: 1, maximum: 10 }
      }
    }
  }
});

// The built directory structure
//
// ├── dist-electron
// │   ├── main.cjs
// │   ├── preload.cjs
// │   └── ...other-support-files
// ├── dist (frontend build)
// │   ├── index.html
// │   ├── assets
// │   └── ...other-static-files
// ├── public
// │   └── vite.svg (example)
// └──

// Disable GPU Acceleration for Windows 7
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// Global variables for model session with proper memory management
let depthSession: ort.InferenceSession | null = null;
let sessionLoadAttempts = 0;
const MAX_SESSION_LOAD_ATTEMPTS = 3;

// Memory monitoring and management
let lastMemoryCheck = Date.now();
const MEMORY_CHECK_INTERVAL = 30000; // 30 seconds
const MAX_MEMORY_USAGE_MB = 500; // Trigger cleanup at 500MB
const FORCE_GC_THRESHOLD_MB = 800; // Force garbage collection at 800MB

// Add rate limiting configuration
const RATE_LIMIT = {
  maxRetries: DEFAULT_DEPTH_API_MAX_RETRIES,
  delayMs: DEFAULT_DEPTH_API_RETRY_DELAY_MS,
  tooManyRequestsCode: 429
};

// === Memory Management Functions ===
function getMemoryUsage(): { rss: number; heapUsed: number; heapTotal: number } {
  const usage = process.memoryUsage();
  return {
    rss: Math.round(usage.rss / 1024 / 1024), // MB
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024) // MB
  };
}

function logMemoryUsage(context: string): void {
  const memory = getMemoryUsage();
  console.log(`[memory] ${context} - RSS: ${memory.rss}MB, Heap: ${memory.heapUsed}/${memory.heapTotal}MB`);
}

async function cleanupModelSession(): Promise<void> {
  if (depthSession) {
    try {
      console.log('[model] Cleaning up ONNX session...');
      await depthSession.release();
      depthSession = null;
      sessionLoadAttempts = 0;
      logMemoryUsage('After session cleanup');
    } catch (error) {
      console.error('[model] Error during session cleanup:', error);
    }
  }
}

async function performMemoryCleanup(): Promise<void> {
  console.log('[memory] Performing memory cleanup...');
  logMemoryUsage('Before cleanup');

  // Clear depth cache if memory is high
  const memory = getMemoryUsage();
  if (memory.rss > MAX_MEMORY_USAGE_MB) {
    try {
      // Clear old cached depth maps
      const depthCacheKeys = Object.keys(global).filter(key => key.startsWith('depth_cache_'));
      depthCacheKeys.forEach(key => {
        delete (global as any)[key];
      });
      console.log('[memory] Cleared', depthCacheKeys.length, 'depth cache entries from memory');
    } catch (error) {
      console.warn('[memory] Error clearing depth cache:', error);
    }
  }

  // Force garbage collection if available and memory is very high
  if (memory.rss > FORCE_GC_THRESHOLD_MB && typeof global.gc === 'function') {
    console.log('[memory] Forcing garbage collection...');
    global.gc();
    logMemoryUsage('After forced GC');
  }

  logMemoryUsage('After cleanup');
}

async function reloadModelSession(): Promise<boolean> {
  await cleanupModelSession();
  
  if (sessionLoadAttempts >= MAX_SESSION_LOAD_ATTEMPTS) {
    console.error('[model] Max session load attempts reached');
    return false;
  }
  
  sessionLoadAttempts++;
  console.log(`[model] Attempting to reload session (attempt ${sessionLoadAttempts}/${MAX_SESSION_LOAD_ATTEMPTS})`);
  
  try {
    await loadModel();
    return depthSession !== null;
  } catch (error) {
    console.error('[model] Failed to reload session:', error);
    return false;
  }
}

// === Helper Function for Depth Data ===
type DepthFetchOptions = {
  maxRetries?: number;
  retryDelayMs?: number;
};

type DepthDataSource = 'json' | 'protobuf' | 'legacy';

class StreetViewDepthError extends Error {
  constructor(
    message: string,
    public code: DepthDataErrorCode | 'RATE_LIMIT',
    public details?: unknown
  ) {
    super(message);
    this.name = 'StreetViewDepthError';
  }
}

const depthProto = parseProto(`
syntax = "proto3";

message DepthPlane {
  float nx = 1;
  float ny = 2;
  float nz = 3;
  float d = 4;
}

message DepthMap {
  int32 width = 1;
  int32 height = 2;
  repeated DepthPlane planes = 3;
  bytes indices = 4;
}
`);

const DepthMapMessage = depthProto.root.lookupType('DepthMap');

function mapHttpStatusToErrorCode(status: number): DepthDataErrorCode {
  if (status === 404) {
    return 'NOT_FOUND';
  }
  if (status >= 500) {
    return 'SERVER_ERROR';
  }
  if (status >= 400) {
    return 'NETWORK_ERROR';
  }
  return 'UNKNOWN_ERROR';
}

function parseRetryAfter(headers: Headers): number | undefined {
  const header = headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}

function normalizePlane(plane: any): DepthPlane {
  return {
    nx: Number(plane?.nx ?? plane?.x ?? plane?.[0] ?? 0),
    ny: Number(plane?.ny ?? plane?.y ?? plane?.[1] ?? 0),
    nz: Number(plane?.nz ?? plane?.z ?? plane?.[2] ?? 0),
    d: Number(plane?.d ?? plane?.w ?? plane?.distance ?? plane?.[3] ?? 0)
  };
}

function coerceToUint8Array(value: any): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  if (typeof value === 'string') {
    try {
      return new Uint8Array(Buffer.from(value, 'base64'));
    } catch (_error) {
      return null;
    }
  }
  if (value?.type === 'Buffer' && Array.isArray(value?.data)) {
    return Uint8Array.from(value.data);
  }
  return null;
}

function decodeLegacyDepthMapBuffer(buffer: Uint8Array): DecodedDepthData | null {
  if (!buffer || buffer.length < 8) {
    return null;
  }

  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let data = raw;

  try {
    const inflated = inflateSync(raw);
    if (inflated && inflated.length > 0) {
      data = inflated;
    }
  } catch (_error) {
    // Buffer was not compressed; continue with original data
  }

  if (data.length < 8) {
    return null;
  }

  const headerSize = data.readUInt8(0);
  const planeCount = data.readUInt8(1);
  const width = data.readUInt16LE(2);
  const height = data.readUInt16LE(4);
  const offset = data.readUInt16LE(6);

  if (!width || !height || headerSize < 8 || offset > data.length) {
    return null;
  }

  const planes: DepthPlane[] = [];
  let cursor = headerSize;

  for (let i = 0; i < planeCount; i++) {
    if (cursor + 16 > data.length) break;
    planes.push({
      nx: data.readFloatLE(cursor),
      ny: data.readFloatLE(cursor + 4),
      nz: data.readFloatLE(cursor + 8),
      d: data.readFloatLE(cursor + 12)
    });
    cursor += 16;
  }

  const expectedLength = width * height;
  if (offset + expectedLength > data.length) {
    return null;
  }

  const indices = new Uint8Array(data.subarray(offset, offset + expectedLength));

  return {
    planes,
    indices,
    width,
    height
  };
}

function decodeLegacyDepthMapBase64(encoded: string): DecodedDepthData | null {
  try {
    const buffer = Buffer.from(encoded, 'base64');
    return decodeLegacyDepthMapBuffer(buffer);
  } catch (_error) {
    return null;
  }
}

function tryDecodeProtobuf(buffer: Uint8Array): DecodedDepthData | null {
  try {
    const decoded = DepthMapMessage.decode(buffer) as any;
    const width = decoded?.width ?? decoded?.imageWidth;
    const height = decoded?.height ?? decoded?.imageHeight;

    if (!width || !height) {
      return null;
    }

    const planeArray: DepthPlane[] = Array.isArray(decoded?.planes)
      ? decoded.planes.map((plane: any) => normalizePlane(plane))
      : [];

    const indices = coerceToUint8Array(decoded?.indices);
    if (!indices || indices.length === 0) {
      return null;
    }

    return {
      planes: planeArray,
      indices: new Uint8Array(indices),
      width,
      height
    };
  } catch (_error) {
    return null;
  }
}

function parseDepthDataFromBinary(buffer: Uint8Array): { data: DecodedDepthData; source: DepthDataSource } {
  const proto = tryDecodeProtobuf(buffer);
  if (proto) {
    return { data: proto, source: 'protobuf' };
  }

  let inflated: Buffer | null = null;
  try {
    inflated = inflateSync(Buffer.from(buffer));
  } catch (_error) {
    inflated = null;
  }

  if (inflated && inflated.length > 0) {
    const protoInflated = tryDecodeProtobuf(inflated);
    if (protoInflated) {
      return { data: protoInflated, source: 'protobuf' };
    }

    const legacyInflated = decodeLegacyDepthMapBuffer(inflated);
    if (legacyInflated) {
      return { data: legacyInflated, source: 'legacy' };
    }
  }

  const legacy = decodeLegacyDepthMapBuffer(buffer);
  if (legacy) {
    return { data: legacy, source: 'legacy' };
  }

  throw new StreetViewDepthError('Unrecognized Street View depth binary payload', 'INVALID_RESPONSE', { length: buffer.length });
}

function parseDepthDataFromJson(payload: any): { data: DecodedDepthData; source: DepthDataSource } {
  if (!payload) {
    throw new StreetViewDepthError('Empty Street View depth response', 'INVALID_RESPONSE');
  }

  if (payload.error) {
    const errorStatus = typeof payload.error.status === 'string' ? payload.error.status.toUpperCase() : undefined;
    const errorCodeString = typeof payload.error.code === 'string' ? payload.error.code.toUpperCase() : undefined;
    if (payload.error.code === 429 || errorStatus === 'RESOURCE_EXHAUSTED' || errorCodeString === 'RESOURCE_EXHAUSTED') {
      throw new StreetViewDepthError(payload.error.message ?? 'Street View depth API rate limit exceeded', 'RATE_LIMIT', payload.error);
    }
    throw new StreetViewDepthError(payload.error.message ?? 'Street View depth API error', mapHttpStatusToErrorCode(Number(payload.error.code)), payload.error);
  }

  const status = typeof payload.status === 'string' ? payload.status.toUpperCase() : undefined;
  if (status && status !== 'OK') {
    if (status === 'RESOURCE_EXHAUSTED' || status === 'OVER_QUERY_LIMIT' || status === 'RATE_LIMIT_EXCEEDED') {
      throw new StreetViewDepthError(payload.error_message ?? 'Street View depth API rate limit exceeded', 'RATE_LIMIT', payload);
    }
    if (status === 'NOT_FOUND' || status === 'ZERO_RESULTS') {
      throw new StreetViewDepthError(payload.error_message ?? 'No Street View depth data available for this panorama', 'NOT_FOUND', payload);
    }
  }

  const depthNode = payload.depthMap ?? payload.depth_map ?? payload.depth ?? payload.result ?? payload;

  if (depthNode?.error) {
    return parseDepthDataFromJson(depthNode);
  }

  if (typeof depthNode === 'string') {
    const legacyFromString = decodeLegacyDepthMapBase64(depthNode);
    if (legacyFromString) {
      return { data: legacyFromString, source: 'legacy' };
    }
  }

  const base64Data = depthNode?.data ?? payload.depthMapData ?? payload.depth_data;
  if (typeof base64Data === 'string') {
    const legacyFromData = decodeLegacyDepthMapBase64(base64Data);
    if (legacyFromData) {
      return { data: legacyFromData, source: 'legacy' };
    }
  }

  if (depthNode?.planes && depthNode?.indices !== undefined) {
    const width = Number(depthNode.width ?? payload.width ?? 0);
    const height = Number(depthNode.height ?? payload.height ?? 0);

    if (!width || !height) {
      throw new StreetViewDepthError('Street View depth payload missing dimensions', 'INVALID_RESPONSE', depthNode);
    }

    const indices = coerceToUint8Array(depthNode.indices);
    if (!indices) {
      throw new StreetViewDepthError('Street View depth payload missing indices', 'INVALID_RESPONSE', depthNode);
    }

    const planes = Array.isArray(depthNode.planes)
      ? depthNode.planes.map((plane: any) => normalizePlane(plane))
      : [];

    return {
      data: {
        planes,
        indices,
        width,
        height
      },
      source: 'json'
    };
  }

  throw new StreetViewDepthError('Street View depth response did not include recognizable depth data', 'INVALID_RESPONSE', payload);
}

async function extractErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    try {
      const json = JSON.parse(text);
      if (json?.error?.message) {
        return json.error.message;
      }
      if (typeof json?.message === 'string') {
        return json.message;
      }
      if (typeof json?.status === 'string' && json?.status !== 'OK' && typeof json?.error_message === 'string') {
        return json.error_message;
      }
      return text;
    } catch (_jsonError) {
      return text;
    }
  } catch (_error) {
    return undefined;
  }
}

async function getRawDepthData(panoId: string, options: DepthFetchOptions = {}): Promise<DepthDataFetchResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return {
      status: 'error',
      code: 'NO_API_KEY',
      message: 'Google Maps API key is not configured for Street View depth requests.',
      attempts: 0
    };
  }

  const sanitizedMaxRetries = Math.max(1, Math.floor(options.maxRetries ?? RATE_LIMIT.maxRetries));
  const sanitizedDelay = Math.max(0, Math.floor(options.retryDelayMs ?? RATE_LIMIT.delayMs));

  const depthUrl = new URL('https://streetviewpixels.googleapis.com/v1/depthmap');
  depthUrl.searchParams.set('pano_id', panoId);
  depthUrl.searchParams.set('output_type', 'depth');
  depthUrl.searchParams.set('key', apiKey);

  let attempt = 0;
  let lastError: { code: DepthDataErrorCode; message: string; details?: unknown } | null = null;

  while (attempt < sanitizedMaxRetries) {
    attempt++;
    try {
      const response = await fetch(depthUrl.toString(), {
        headers: {
          Accept: 'application/x-protobuf, application/json'
        }
      });

      if (response.status === RATE_LIMIT.tooManyRequestsCode) {
        const retryAfter = parseRetryAfter(response.headers) ?? sanitizedDelay;
        console.warn(`[depth] Rate limited fetching pano ${panoId}. Attempt ${attempt}/${sanitizedMaxRetries}.`);
        if (attempt >= sanitizedMaxRetries) {
          return {
            status: 'rate-limit',
            code: 'RATE_LIMIT',
            message: 'Street View depth API rate limit exceeded.',
            retryAfterMs: retryAfter,
            attempts: attempt
          };
        }
        await sleep(retryAfter);
        continue;
      }

      if (!response.ok) {
        const message = (await extractErrorMessage(response)) ?? `Street View depth API returned status ${response.status}`;
        const errorCode = mapHttpStatusToErrorCode(response.status);
        lastError = { code: errorCode, message, details: { status: response.status } };

        if (errorCode === 'NOT_FOUND') {
          return {
            status: 'error',
            code: errorCode,
            message,
            details: { status: response.status },
            attempts: attempt
          };
        }

        if (attempt >= sanitizedMaxRetries) {
          break;
        }

        await sleep(sanitizedDelay);
        continue;
      }

      const contentType = response.headers.get('content-type') ?? '';

      try {
        const result = contentType.includes('application/json')
          ? parseDepthDataFromJson(await response.json())
          : parseDepthDataFromBinary(new Uint8Array(await response.arrayBuffer()));

        console.log(`[depth] Retrieved Street View depth data (${result.source}) for pano ${panoId} on attempt ${attempt}.`);
        return {
          status: 'success',
          data: result.data,
          source: result.source,
          fetchedAt: Date.now(),
          attempts: attempt
        };
      } catch (parseError) {
        if (parseError instanceof StreetViewDepthError) {
          if (parseError.code === 'RATE_LIMIT') {
            console.warn(`[depth] Street View depth API signaled rate limit on attempt ${attempt}.`);
            if (attempt >= sanitizedMaxRetries) {
              return {
                status: 'rate-limit',
                code: 'RATE_LIMIT',
                message: parseError.message,
                attempts: attempt,
                retryAfterMs: sanitizedDelay
              };
            }
            await sleep(sanitizedDelay);
            continue;
          }

          if (parseError.code === 'NOT_FOUND') {
            return {
              status: 'error',
              code: 'NOT_FOUND',
              message: parseError.message,
              details: parseError.details,
              attempts: attempt
            };
          }

          lastError = {
            code: parseError.code as DepthDataErrorCode,
            message: parseError.message,
            details: parseError.details
          };
        } else {
          lastError = {
            code: 'INVALID_RESPONSE',
            message: 'Failed to parse Street View depth response payload.',
            details: parseError instanceof Error ? { message: parseError.message } : parseError
          };
        }

        if (attempt >= sanitizedMaxRetries) {
          break;
        }

        await sleep(sanitizedDelay);
      }
    } catch (error) {
      console.error(`[depth] Network error fetching Street View depth data (attempt ${attempt}/${sanitizedMaxRetries}):`, error);
      lastError = {
        code: 'NETWORK_ERROR',
        message: 'Network error while requesting Street View depth data.',
        details: error instanceof Error ? { message: error.message } : error
      };

      if (attempt >= sanitizedMaxRetries) {
        break;
      }

      await sleep(sanitizedDelay);
    }
  }

  if (lastError) {
    return {
      status: 'error',
      code: lastError.code,
      message: lastError.message,
      details: lastError.details,
      attempts: attempt
    };
  }

  return {
    status: 'error',
    code: 'UNKNOWN_ERROR',
    message: 'Street View depth data could not be retrieved.',
    attempts: attempt
  };
}

let win: BrowserWindow | null = null;

// Calculate the preload script path
const preloadScriptPath = join(__dirname, 'preload.cjs');

// Determine the correct path for index.html
// In dev, vite-plugin-electron sets VITE_DEV_SERVER_URL.
// In prod, index.html is in the 'dist' folder adjacent to 'dist-electron'.
const devServerUrl = process.env.VITE_DEV_SERVER_URL; // Get the potential URL from vite-plugin-electron
const indexHtmlPath = join(__dirname, '../dist/index.html'); // Path to index.html relative to main.cjs

// --- Model selection logic ---
const envModelFilename = process.env.DEPTH_MODEL_FILENAME; // optional override via .env

// Primary model we ship with the repo (≈94 MB, outdoor metric)
const primaryModelFilename = 'depth_anything_v2_metric_vkitti_vits.onnx';
// Fallback to tiny (33 MB) if user supplies it manually
const tinyModelFilename = 'depth_anything_v2_vit_tiny_metric_outdoor.onnx';

let selectedModelFilename = primaryModelFilename;

if (envModelFilename) {
  selectedModelFilename = envModelFilename;
} else if (!existsSync(join(__dirname, '..', 'src', 'assets', 'models', primaryModelFilename)) && existsSync(join(__dirname, '..', 'src', 'assets', 'models', tinyModelFilename))) {
  selectedModelFilename = tinyModelFilename;
}

const isTinyModel = selectedModelFilename.includes('vit_tiny');

let modelInputShape: [number, number, number, number] = isTinyModel ? [1, 3, 384, 384] : [1, 3, 518, 518];

const appPath = app.getAppPath(); // Use app.getAppPath() for a reliable base
const modelRelativePath = join('src', 'assets', 'models', selectedModelFilename);

const modelPath = app.isPackaged
  ? join(appPath, '..', 'app.asar.unpacked', modelRelativePath) // Path when packaged (assuming asarUnpack)
  : join(__dirname, '..', modelRelativePath); // Dev path relative to dist-electron

const modelExists = existsSync(modelPath);

async function loadModel(): Promise<void> {
  console.log('[model] Model path:', modelPath);
  console.log('[model] Model exists:', modelExists);
  console.log('[model] __dirname:', __dirname);
  console.log('[model] app.getAppPath():', app.getAppPath());
  console.log('[model] app.isPackaged:', app.isPackaged);
  
  if (!modelExists) {
    console.error('[model] Model file not found at:', modelPath);
    if (win) {
      win.webContents.send('main-process-message', { type: 'error', message: 'ONNX model file not found.' });
    }
    return;
  }
  
  try {
    console.log('[model] Loading ONNX model...');
    logMemoryUsage('Before model load');
    
    // Configure session options for better memory management
    const sessionOptions: ort.InferenceSession.SessionOptions = {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      enableCpuMemArena: true,
      enableMemPattern: true,
      executionMode: 'sequential',
      extra: {
        session: {
          use_ort_model_bytes_directly: true,
          use_per_session_threads: true,
          session_logid: 'PoleCheckDepthModel'
        }
      }
    };
    
    // Try with optimized session options
    depthSession = await ort.InferenceSession.create(modelPath, sessionOptions);
    
    console.log('[model] Model loaded successfully');
    console.log('[model] Input names:', depthSession.inputNames);
    console.log('[model] Output names:', depthSession.outputNames);
    logMemoryUsage('After model load');
    
    if (win) {
      win.webContents.send('main-process-message', { type: 'model-status', status: 'loaded' });
    }

  } catch (error) {
    depthSession = null;
    console.error('[model] Failed to load model:', error);
    logMemoryUsage('After model load failure');
    
    if (win) {
      win.webContents.send('main-process-message', { type: 'error', message: `Failed to load ONNX model: ${error}` });
    }
    
    throw error; // Re-throw for proper error handling
  }
}
// --- End ONNX Setup ---

async function createWindow() {
  if (!existsSync(preloadScriptPath)) {
    throw new Error('Preload script not found');
  }

  win = new BrowserWindow({
    title: 'PoleCheck Desktop',
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: preloadScriptPath,
    },
  });

  win.webContents.on('did-fail-load', (event: Event, errorCode: number, errorDescription: string, validatedURL: string) => {
    if (validatedURL === devServerUrl) {
      dialog.showErrorBox('Development Load Error', `Could not connect to the Vite development server at:\n${devServerUrl}\n\nPlease ensure 'npm run dev' is running.`);
    } else if (validatedURL.startsWith('file://') && validatedURL.endsWith(indexHtmlPath)) {
      if (!existsSync(indexHtmlPath)) {
        dialog.showErrorBox('Application Error', `Failed to load essential components. index.html not found at:\n${indexHtmlPath}`);
        app.quit();
        return;
      }
      dialog.showErrorBox('Production Load Error', `Could not load the application file:\n${indexHtmlPath}`);
    }
  });

  if (devServerUrl && !app.isPackaged) {
    await win.loadURL(devServerUrl).catch((_err: Error) => {
      dialog.showErrorBox('Development Load Error', `Could not connect to the Vite development server at:\n${devServerUrl}\n\nPlease ensure 'npm run dev' is running.`);
    });
    win.webContents.openDevTools();
  } else {
    if (!existsSync(indexHtmlPath)) {
      dialog.showErrorBox('Application Error', `Failed to load essential components. index.html not found at:\n${indexHtmlPath}`);
      app.quit();
      return;
    }
    await win.loadFile(indexHtmlPath).catch((_err: Error) => {
      dialog.showErrorBox('Production Load Error', `Could not load the application file:\n${indexHtmlPath}`);
    });
  }

  win.webContents.on('dom-ready', () => {
    win?.webContents.send('main-process-message', { type: 'status', message: 'Main process ready, window loaded.' });
  });

  // Set up IPC handlers
  // Depth inference handler with improved error handling and memory management
  ipcMain.handle('infer-depth', async (event: IpcMainInvokeEvent, imageDataUrl: string) => {
    console.log('[infer-depth] request received');
    
    if (!depthSession) {
      console.warn('[infer-depth] No depth session available, attempting reload...');
      const reloadSuccess = await reloadModelSession();
      if (!reloadSuccess) {
        event.sender.send('main-process-message', { type: 'error', message: 'Depth model is not available and could not be reloaded.'});
        return null;
      }
    }

    try {
      console.time('[infer-depth] preprocess');
      logMemoryUsage('Before inference');
      
      // Process image data and run inference
      const base64Data = imageDataUrl.split(',')[1];
      if (!base64Data) throw new Error('Invalid image data');
      
      const imageBuffer = Buffer.from(base64Data, 'base64');
      const image = sharp(imageBuffer);

      // Record original dimensions to help map viewport coordinates
      const metadata = await image.metadata();
      const originalWidth = metadata.width ?? modelInputShape[3];
      const originalHeight = metadata.height ?? modelInputShape[2];

      // Resize to the model's expected input while ignoring aspect ratio
      const resizedWidth = modelInputShape[3];
      const resizedHeight = modelInputShape[2];
      const resizedBuffer = await image
        .resize(resizedWidth, resizedHeight, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer();

      const float32Data = new Float32Array(modelInputShape[1] * modelInputShape[2] * modelInputShape[3]);
      for (let i = 0; i < modelInputShape[2] * modelInputShape[3]; i++) {
         float32Data[i] = resizedBuffer[i * 3] / 255.0;         // R channel
         float32Data[modelInputShape[2] * modelInputShape[3] + i] = resizedBuffer[i * 3 + 1] / 255.0; // G channel
         float32Data[2 * modelInputShape[2] * modelInputShape[3] + i] = resizedBuffer[i * 3 + 2] / 255.0; // B channel
       }
      console.timeEnd('[infer-depth] preprocess');

      // Create tensor from the processed float data
      const inputTensor = new ort.Tensor('float32', float32Data, modelInputShape);
      const feeds: Record<string, ort.Tensor> = {};
      feeds[depthSession!.inputNames[0]] = inputTensor;
      
      console.time('[infer-depth] inference');
      const results = await depthSession!.run(feeds);
      console.timeEnd('[infer-depth] inference');

      const outputTensor = results[depthSession!.outputNames[0]];
      console.log('[infer-depth] output dims', outputTensor.dims, 'dataLen', (outputTensor.data as Float32Array).length);

      let h: number | undefined;
      let w: number | undefined;
      if (outputTensor.dims.length === 4) {
        // Expected [1,1,H,W]
        h = outputTensor.dims[2];
        w = outputTensor.dims[3];
      } else if (outputTensor.dims.length === 3) {
        // Some exporters drop the channel dim: [1,H,W]
        h = outputTensor.dims[1];
        w = outputTensor.dims[2];
      }

      if (!w || !h || !(outputTensor.data instanceof Float32Array) || (outputTensor.data as Float32Array).length === 0) {
        throw new Error('ONNX output tensor invalid');
      }
      
      // Parameters describing how the image was resized prior to inference
      const transform = {
        originalWidth,
        originalHeight,
        resizedWidth,
        resizedHeight,
        scaleX: resizedWidth / originalWidth,
        scaleY: resizedHeight / originalHeight,
        offsetX: 0,
        offsetY: 0
      };
      const settings = store.get('settings', {} as any) as any;
      const scale = (settings.depthScale ?? MODEL_CALIBRATIONS[selectedModelFilename]?.scale ?? 1) as number;
      const bias = (settings.depthBias ?? MODEL_CALIBRATIONS[selectedModelFilename]?.bias ?? 0) as number;
      
      logMemoryUsage('After inference');
      return {
        data: Array.from(outputTensor.data as Float32Array, (v) => v * scale + bias),
        width: w,
        height: h,
        transform
      };
    } catch (error) {
      console.error('[infer-depth] failed', error);
      logMemoryUsage('After inference failure');
      
      // Attempt to recover from session errors
      if (error instanceof Error && error.message.includes('session')) {
        console.warn('[infer-depth] Session error detected, attempting reload...');
        await reloadModelSession();
      }
      
      event.sender.send('main-process-message', { type: 'error', message: `Depth inference failed: ${error}` });
      return null;
    }
  });

  // CSV export handler
  ipcMain.handle('csv-export', async (event: IpcMainInvokeEvent, csvContent: string) => {
    if (!win) return null;

    try {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Export Measurements as CSV',
        defaultPath: `polecheck-measurements-${Date.now()}.csv`,
        filters: [
          { name: 'CSV Files', extensions: ['csv'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (canceled || !filePath) return null;

      await fs.promises.writeFile(filePath, csvContent, 'utf8');
      return filePath;
    } catch (error) {
      return null;
    }
  });

  // Depth data fetch handler
  ipcMain.handle('fetch-depth-data', async (_event: IpcMainInvokeEvent, payload: string | { panoId: string; maxRetries?: number; retryDelayMs?: number }) => {
    const request = typeof payload === 'string' ? { panoId: payload } : payload ?? { panoId: '' };

    if (!request.panoId) {
      const invalidRequest: DepthDataFetchResult = {
        status: 'error',
        code: 'INVALID_RESPONSE',
        message: 'Panorama ID is required to fetch Street View depth data.',
        attempts: 0
      };
      return invalidRequest;
    }

    try {
      const settings = store.get('settings', {}) as { depthApiMaxRetries?: number };
      const requestedRetries = Number.isFinite(Number(request.maxRetries)) ? Number(request.maxRetries) : undefined;
      const persistedRetries = Number.isFinite(Number(settings?.depthApiMaxRetries)) ? Number(settings?.depthApiMaxRetries) : undefined;
      const effectiveMaxRetries = requestedRetries ?? persistedRetries ?? RATE_LIMIT.maxRetries;
      const result = await getRawDepthData(request.panoId, {
        maxRetries: effectiveMaxRetries,
        retryDelayMs: Number.isFinite(Number(request.retryDelayMs)) ? Number(request.retryDelayMs) : RATE_LIMIT.delayMs
      });
      return result;
    } catch (error) {
      console.error('[depth] Unexpected error while fetching Street View depth data:', error);
      const fallback: DepthDataFetchResult = {
        status: 'error',
        code: 'UNKNOWN_ERROR',
        message: 'Unexpected error while requesting Street View depth data.',
        details: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        attempts: 0
      };
      return fallback;
    }
  });

  // Persistence handlers
  ipcMain.handle('get-projects', async () => {
    try {
      return store.get('projects', {});
    } catch (error) {
      return {};
    }
  });

  // Measurements persistence handlers
  ipcMain.handle('get-measurements', async () => {
    try {
      return store.get('measurements', []);
    } catch (_error) {
      return [];
    }
  });

  ipcMain.handle('save-measurements', async (_event: IpcMainInvokeEvent, measurements: any[]) => {
    try {
      store.set('measurements', measurements);
      return true;
    } catch (_error) {
      return false;
    }
  });

  ipcMain.handle('save-project', async (event: IpcMainInvokeEvent, project: any) => {
    try {
      const projects = store.get('projects', {});
      projects[project.id] = project;
      store.set('projects', projects);
      return true;
    } catch (_error) {
      return false;
    }
  });

  ipcMain.handle('delete-project', async (event: IpcMainInvokeEvent, projectId: string) => {
    try {
      const projects = store.get('projects', {});
      delete projects[projectId];
      store.set('projects', projects);
      return true;
    } catch (_error) {
      return false;
    }
  });

  ipcMain.handle('get-settings', async () => {
    try {
      return store.get('settings', {
        defaultUnit: 'metric',
        autoSave: true,
        theme: 'light',
        language: 'en',
        measurementHistoryLimit: 1000,
        useGPU: false,
        calibrationPitchOffsetDeg: 0,
        depthScale: 1,
        depthBias: 0,
        depthApiMaxRetries: DEFAULT_DEPTH_API_MAX_RETRIES
      });
    } catch (_error) {
      return {
        defaultUnit: 'metric',
        autoSave: true,
        theme: 'light',
        language: 'en',
        measurementHistoryLimit: 1000,
        useGPU: false,
        calibrationPitchOffsetDeg: 0,
        depthScale: 1,
        depthBias: 0,
        depthApiMaxRetries: DEFAULT_DEPTH_API_MAX_RETRIES
      };
    }
  });

  ipcMain.handle('save-settings', async (event: IpcMainInvokeEvent, settings: any) => {
    try {
      store.set('settings', settings);
      return true;
    } catch (_error) {
      return false;
    }
  });

  ipcMain.handle('clear-data', async () => {
    try {
      store.delete('measurements');
      return true;
    } catch (_error) {
      return false;
    }
  });
}

// Modify app.whenReady() to ensure proper initialization
app.whenReady().then(async () => {
  try {
    await loadModel();
  } catch (_error) {
    // Continue anyway, as we want the app to at least start
  }

  try {
    await createWindow();
  } catch (_error) {
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  // Clean up ONNX session before quitting
  await cleanupModelSession();
  win = null;
  if (process.platform !== 'darwin') app.quit();
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
});

// Handle any uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('[fatal] Uncaught exception:', error);
  await cleanupModelSession();
  app.quit();
});

process.on('unhandledRejection', async (reason: any, _promise: Promise<any>) => {
  console.error('[fatal] Unhandled rejection:', reason);
  if (win) {
    const wc = win.webContents;
    if (!wc.isDestroyed()) {
        wc.send('main-process-message', { type: 'error', message: `Unhandled Rejection: ${reason}` });
    }
  }
});

// Periodic memory monitoring and cleanup
setInterval(async () => {
  const now = Date.now();
  if (now - lastMemoryCheck >= MEMORY_CHECK_INTERVAL) {
    const memory = getMemoryUsage();
    logMemoryUsage('Periodic check');

    // Perform cleanup if memory usage is high
    if (memory.rss > MAX_MEMORY_USAGE_MB) {
      await performMemoryCleanup();
    }

    lastMemoryCheck = now;
  }
}, MEMORY_CHECK_INTERVAL);

// Graceful shutdown handling
process.on('SIGINT', async () => {
  console.log('[shutdown] Received SIGINT, cleaning up...');
  await cleanupModelSession();
  app.quit();
});

process.on('SIGTERM', async () => {
  console.log('[shutdown] Received SIGTERM, cleaning up...');
  await cleanupModelSession();
  app.quit();
}); 
