import { Point } from '../types/common';

/**
 * Represents a binary edge map.
 */
export interface EdgeMap {
  data: Uint8ClampedArray; // 1 for edge, 0 for non-edge
  width: number;
  height: number;
}

/**
 * Converts an ImageBitmap to grayscale ImageData.
 * @param imageBitmap The input image.
 * @returns Grayscale ImageData or null if failed.
 */
function getGrayscaleImageData(imageBitmap: ImageBitmap): ImageData | null {
    const canvas = document.createElement('canvas');
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); // Hint for performance
    if (!ctx) {
        console.error("[ImageProcessing] Failed to get 2D context for grayscale conversion.");
        return null;
    }

    ctx.drawImage(imageBitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        // Simple average grayscale (Luminance is more accurate but average is often sufficient)
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        data[i] = avg;     // Red
        data[i + 1] = avg; // Green
        data[i + 2] = avg; // Blue
        // Alpha (data[i + 3]) is kept as is
    }
    return imageData;
}

/**
 * Applies a Sobel operator to detect edges in grayscale image data.
 * @param grayscaleData The input grayscale ImageData.
 * @returns An object containing gradient magnitude data (Float32Array) and max magnitude.
 */
function sobelEdgeDetection(grayscaleData: ImageData): { gradientMagnitude: Float32Array, maxMagnitude: number } {
    const width = grayscaleData.width;
    const height = grayscaleData.height;
    const data = grayscaleData.data;
    const gradientMagnitude = new Float32Array(width * height);
    let maxMagnitude = 0;

    // Sobel kernels
    const kernelX = [
        [-1, 0, 1],
        [-2, 0, 2],
        [-1, 0, 1]
    ];
    const kernelY = [
        [-1, -2, -1],
        [ 0,  0,  0],
        [ 1,  2,  1]
    ];

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let pixelX = 0;
            let pixelY = 0;

            for (let j = -1; j <= 1; j++) {
                for (let i = -1; i <= 1; i++) {
                    const currentX = x + i;
                    const currentY = y + j;
                    const index = (currentY * width + currentX) * 4; // Grayscale, R=G=B
                    const grayValue = data[index];
                    
                    pixelX += grayValue * kernelX[j + 1][i + 1];
                    pixelY += grayValue * kernelY[j + 1][i + 1];
                }
            }

            const magnitude = Math.sqrt(pixelX * pixelX + pixelY * pixelY);
            const outputIndex = y * width + x;
            gradientMagnitude[outputIndex] = magnitude;
            if (magnitude > maxMagnitude) {
                maxMagnitude = magnitude;
            }
        }
    }

    return { gradientMagnitude, maxMagnitude };
}

/**
 * Creates a binary edge map by thresholding Sobel gradient magnitudes.
 * @param imageBitmap The input image.
 * @param thresholdRatio A value between 0 and 1. Edges are detected where 
 *                       gradient magnitude exceeds thresholdRatio * maxMagnitude.
 * @returns An EdgeMap object or null if failed.
 */
export function createEdgeMap(imageBitmap: ImageBitmap, thresholdRatio: number = 0.15): EdgeMap | null {
    const grayscaleImageData = getGrayscaleImageData(imageBitmap);
    if (!grayscaleImageData) {
        return null;
    }

    const { gradientMagnitude, maxMagnitude } = sobelEdgeDetection(grayscaleImageData);
    
    const width = imageBitmap.width;
    const height = imageBitmap.height;
    const edgeData = new Uint8ClampedArray(width * height);
    const threshold = maxMagnitude * thresholdRatio;

    for (let i = 0; i < gradientMagnitude.length; i++) {
        if (gradientMagnitude[i] > threshold) {
            edgeData[i] = 1; // Mark as edge
        } else {
            edgeData[i] = 0; // Mark as non-edge
        }
    }

    console.log(`[ImageProcessing] Created edge map ${width}x${height}. Max Magnitude: ${maxMagnitude.toFixed(2)}, Threshold: ${threshold.toFixed(2)}`);
    return { data: edgeData, width, height };
}

/**
 * Finds the closest edge point within a given radius around a target point.
 * 
 * @param targetPoint The center point to search around.
 * @param edgeMap The binary edge map.
 * @param radius The search radius in pixels.
 * @returns The coordinates of the closest edge point, or null if no edge found within radius.
 */
export function findClosestEdge(targetPoint: Point, edgeMap: EdgeMap, radius: number): Point | null {
    const { data, width, height } = edgeMap;
    let closestPoint: Point | null = null;
    let minDistanceSq = radius * radius;

    const startX = Math.max(0, Math.floor(targetPoint.x - radius));
    const endX = Math.min(width - 1, Math.ceil(targetPoint.x + radius));
    const startY = Math.max(0, Math.floor(targetPoint.y - radius));
    const endY = Math.min(height - 1, Math.ceil(targetPoint.y + radius));

    for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
            const index = y * width + x;
            if (data[index] === 1) { // Is it an edge pixel?
                const dx = x - targetPoint.x;
                const dy = y - targetPoint.y;
                const distSq = dx * dx + dy * dy;

                if (distSq <= minDistanceSq) {
                    minDistanceSq = distSq;
                    closestPoint = { x, y };
                }
            }
        }
    }

    return closestPoint;
} 