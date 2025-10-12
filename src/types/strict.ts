// Strict type definitions for production-level type safety
import { z } from 'zod';

// Branded types for type safety
export type Brand<T, B> = T & { __brand: B };

// Coordinate types with validation
export type Latitude = Brand<number, 'Latitude'>;
export type Longitude = Brand<number, 'Longitude'>;
export type Altitude = Brand<number, 'Altitude'>;

// Measurement types with validation
export type Distance = Brand<number, 'Distance'>;
export type Height = Brand<number, 'Height'>;
export type Angle = Brand<number, 'Angle'>;

// ID types for better type safety
export type MeasurementId = Brand<string, 'MeasurementId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type RevisionId = Brand<string, 'RevisionId'>;

// Strict coordinate validation
export const CoordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});

export const StrictCoordinates = z.object({
  lat: z.number().min(-90).max(90).transform((val): Latitude => val as Latitude),
  lng: z.number().min(-180).max(180).transform((val): Longitude => val as Longitude)
});

// Strict measurement validation
export const MeasurementSchema = z.object({
  id: z.string().uuid().transform((val): MeasurementId => val as MeasurementId),
  kind: z.enum(['distance', 'polyline', 'area', 'volume']),
  name: z.string().max(100).optional(),
  label: z.string().min(1).max(50),
  distanceMeters: z.number().nonnegative().optional().transform((val): Distance | undefined => val as Distance | undefined),
  distance: z.number().nonnegative().optional().transform((val): Distance | undefined => val as Distance | undefined),
  unit: z.enum(['metric', 'imperial']),
  startPoint: z.object({
    x: z.number().nonnegative(),
    y: z.number().nonnegative()
  }),
  endPoint: z.object({
    x: z.number().nonnegative(),
    y: z.number().nonnegative()
  }),
  areaSquareMeters: z.number().nonnegative().optional(),
  perimeterMeters: z.number().nonnegative().optional(),
  volumeCubicMeters: z.number().nonnegative().optional(),
  dimensionsMeters: z.object({
    length: z.number().nonnegative(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative()
  }).optional(),
  points: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  timestamp: z.number().positive(),
  projectId: z.string().uuid().optional().transform((val): ProjectId | undefined => val as ProjectId | undefined)
});

// Strict camera parameters validation
export const CameraParamsSchema = z.object({
  panoId: z.string().optional(),
  lat: z.number().min(-90).max(90).optional().transform((val): Latitude | undefined => val as Latitude | undefined),
  lng: z.number().min(-180).max(180).optional().transform((val): Longitude | undefined => val as Longitude | undefined),
  heading: z.number().min(0).max(360).optional().transform((val): Angle | undefined => val as Angle | undefined),
  pitch: z.number().min(-90).max(90).optional().transform((val): Angle | undefined => val as Angle | undefined),
  zoom: z.number().min(0).max(20).optional(),
  fov: z.number().positive().optional(),
  vFov: z.number().positive().optional(),
  cameraHeight: z.number().positive().optional().transform((val): Altitude | undefined => val as Altitude | undefined)
});

// Strict project validation
export const ProjectSchema = z.object({
  id: z.string().uuid().transform((val): ProjectId => val as ProjectId),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  createdAt: z.number().positive(),
  updatedAt: z.number().positive(),
  measurements: z.array(MeasurementSchema),
  revisions: z.array(z.object({
    id: z.string().uuid().transform((val): RevisionId => val as RevisionId),
    timestamp: z.number().positive(),
    measurements: z.array(MeasurementSchema),
    description: z.string().max(200).optional()
  }))
});

// Strict settings validation
export const SettingsSchema = z.object({
  defaultUnit: z.enum(['metric', 'imperial']),
  autoSave: z.boolean(),
  autoSaveInterval: z.number().min(1000).max(60000),
  theme: z.enum(['light', 'dark', 'auto']),
  language: z.string().length(2),
  notifications: z.boolean(),
  shortcuts: z.record(z.string(), z.string()),
  advanced: z.object({
    enableDebugMode: z.boolean(),
    enablePerformanceMonitoring: z.boolean(),
    enableErrorReporting: z.boolean(),
    maxCacheSize: z.number().positive(),
    maxHistorySize: z.number().positive()
  })
});

// Runtime validation functions
export const validateCoordinates = (coords: unknown): coords is { lat: Latitude; lng: Longitude } => {
  try {
    StrictCoordinates.parse(coords);
    return true;
  } catch {
    return false;
  }
};

export const validateMeasurement = (measurement: unknown): measurement is z.infer<typeof MeasurementSchema> => {
  try {
    MeasurementSchema.parse(measurement);
    return true;
  } catch {
    return false;
  }
};

export const validateCameraParams = (params: unknown): params is z.infer<typeof CameraParamsSchema> => {
  try {
    CameraParamsSchema.parse(params);
    return true;
  } catch {
    return false;
  }
};

export const validateProject = (project: unknown): project is z.infer<typeof ProjectSchema> => {
  try {
    ProjectSchema.parse(project);
    return true;
  } catch {
    return false;
  }
};

export const validateSettings = (settings: unknown): settings is z.infer<typeof SettingsSchema> => {
  try {
    SettingsSchema.parse(settings);
    return true;
  } catch {
    return false;
  }
};

// Type guards for runtime type checking
export const isLatitude = (value: number): value is Latitude => {
  return typeof value === 'number' && value >= -90 && value <= 90;
};

export const isLongitude = (value: number): value is Longitude => {
  return typeof value === 'number' && value >= -180 && value <= 180;
};

export const isDistance = (value: number): value is Distance => {
  return typeof value === 'number' && value > 0 && isFinite(value);
};

export const isHeight = (value: number): value is Height => {
  return typeof value === 'number' && value >= 0 && isFinite(value);
};

export const isAngle = (value: number): value is Angle => {
  return typeof value === 'number' && isFinite(value);
};

export const isMeasurementId = (value: string): value is MeasurementId => {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
};

export const isProjectId = (value: string): value is ProjectId => {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
};

// Exhaustive type checking
export const assertNever = (value: never): never => {
  throw new Error(`Unhandled value: ${JSON.stringify(value)}`);
};

// Strict utility types
export type NonNullableFields<T> = {
  [P in keyof T]: NonNullable<T[P]>;
};

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

export type OptionalFields<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// Strict error types
export type ValidationError = {
  type: 'validation';
  field: string;
  message: string;
  value: unknown;
};

export type RuntimeError = {
  type: 'runtime';
  code: string;
  message: string;
  stack?: string;
};

export type NetworkError = {
  type: 'network';
  status: number;
  message: string;
  url: string;
};

export type StrictError = ValidationError | RuntimeError | NetworkError;

// Strict result types
export type Result<T, E = StrictError> = 
  | { success: true; data: T }
  | { success: false; error: E };

// Strict async result types
export type AsyncResult<T, E = StrictError> = Promise<Result<T, E>>;

// Utility functions for strict typing
export const createSuccess = <T>(data: T): Result<T> => ({
  success: true,
  data
});

export const createError = <E>(error: E): Result<never, E> => ({
  success: false,
  error
});

export const isSuccess = <T, E>(result: Result<T, E>): result is { success: true; data: T } => {
  return result.success;
};

export const isError = <T, E>(result: Result<T, E>): result is { success: false; error: E } => {
  return !result.success;
};

// Strict validation decorators
export const validateInput = <T>(schema: z.ZodSchema<T>) => {
  return (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    descriptor.value = function (...args: unknown[]) {
      const validatedArgs = args.map(arg => schema.parse(arg));
      return originalMethod.apply(this, validatedArgs);
    };
    return descriptor;
  };
};

// Strict configuration types
export type StrictConfig = {
  api: {
    baseUrl: string;
    timeout: number;
    retries: number;
    rateLimit: {
      requests: number;
      windowMs: number;
    };
  };
  storage: {
    maxSize: number;
    compression: boolean;
    encryption: boolean;
  };
  performance: {
    enableMonitoring: boolean;
    sampleRate: number;
    maxMetrics: number;
  };
  security: {
    enableCSP: boolean;
    enableHSTS: boolean;
    enableXSS: boolean;
  };
};

// Export all schemas for external use
export const Schemas = {
  Coordinate: CoordinateSchema,
  StrictCoordinates,
  Measurement: MeasurementSchema,
  CameraParams: CameraParamsSchema,
  Project: ProjectSchema,
  Settings: SettingsSchema
} as const;

// Export type helpers
export type StrictCoordinatesType = z.infer<typeof StrictCoordinates>;
export type StrictMeasurementType = z.infer<typeof MeasurementSchema>;
export type StrictCameraParamsType = z.infer<typeof CameraParamsSchema>;
export type StrictProjectType = z.infer<typeof ProjectSchema>;
export type StrictSettingsType = z.infer<typeof SettingsSchema>;
