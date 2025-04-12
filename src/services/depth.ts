// Service to fetch and decode Street View depth data

// Structure for parsed depth data
export interface DepthPlane {
    nx: number; // Normal vector X
    ny: number; // Normal vector Y
    nz: number; // Normal vector Z
    d: number;  // Distance from origin along normal
}

export interface DecodedDepthData {
    planes: DepthPlane[];
    indices: Uint8Array; // 512x256 index map
    width: number;   // Width of the index map (e.g., 512)
    height: number;  // Height of the index map (e.g., 256)
}

// --- Helper functions for parsing binary data ---
function readUInt16LE(buffer: Uint8Array, offset: number): number {
    // DataView allows specifying little-endian
    const view = new DataView(buffer.buffer, buffer.byteOffset);
    return view.getUint16(offset, true); // true for little-endian
}

function readFloat32LE(buffer: Uint8Array, offset: number): number {
    const view = new DataView(buffer.buffer, buffer.byteOffset);
    return view.getFloat32(offset, true); // true for little-endian
}
// --- End Helper Functions ---

function parseDepthMapData(decompressedBytes: Uint8Array): DecodedDepthData | null {
    try {
        // 1. Parse Header
        const headerSize = decompressedBytes[0]; // Typically 8
        if (headerSize !== 8) {
            console.warn("Unexpected depth map header size:", headerSize);
            // Continue anyway? Or return null?
        }
        const numberOfPlanes = readUInt16LE(decompressedBytes, 1);
        const width = readUInt16LE(decompressedBytes, 3);
        const height = readUInt16LE(decompressedBytes, 5);
        const planeDataOffset = readUInt16LE(decompressedBytes, 7);

        console.log("Parsed Header:", { headerSize, numberOfPlanes, width, height, planeDataOffset });

        if (width !== 512 || height !== 256) {
            console.warn(`Unexpected depth map dimensions: ${width}x${height}`);
            // Adjust logic if needed, but for now assume 512x256
        }

        // 2. Extract Index Map
        const indicesStart = headerSize;
        const indicesLength = width * height;
        const indices = new Uint8Array(decompressedBytes.buffer, decompressedBytes.byteOffset + indicesStart, indicesLength);

        // 3. Parse Planes
        const planes: DepthPlane[] = [];
        for (let i = 0; i < numberOfPlanes; i++) {
            const planeOffset = planeDataOffset + i * 16; // Each plane is 4 floats (16 bytes)
            const nx = readFloat32LE(decompressedBytes, planeOffset + 0);
            const ny = readFloat32LE(decompressedBytes, planeOffset + 4);
            const nz = readFloat32LE(decompressedBytes, planeOffset + 8);
            const d = readFloat32LE(decompressedBytes, planeOffset + 12);
            planes.push({ nx, ny, nz, d });
        }

        console.log(`Parsed ${planes.length} planes.`);

        return {
            planes,
            indices,
            width,
            height
        };
    } catch (error) {
        console.error("Error parsing depth map binary data:", error);
        return null;
    }
}

/**
 * Fetches and parses the depth map data for a given panorama ID.
 * Uses unofficial Google endpoints and data formats.
 * NOTE: THIS IS LIKELY DEPRECATED/UNUSED as the app uses ONNX inference.
 * Kept for reference or potential future use.
 * 
 * @param panoId The panorama ID.
 * @returns A Promise resolving to the parsed depth data, or null if fetching/parsing fails.
 */
export async function getParsedDepthData(panoId: string): Promise<DecodedDepthData | null> {
    console.warn(`[getParsedDepthData] This function is likely deprecated. Attempting to call main process for panoId: ${panoId}`);
    
    try {
        // Request raw bytes from main process via IPC using the generic invoke
        // IMPORTANT: Assumes a main process handler named 'fetch-raw-depth-bytes' exists!
        // This handler was likely removed or never implemented.
        const rawData: Uint8Array | null = await window.electronAPI.invoke('fetch-raw-depth-bytes', panoId); 

        if (!rawData) {
            console.error("[getParsedDepthData] Received null data from main process (handler 'fetch-raw-depth-bytes' likely missing or failed).");
            return null;
        }

        console.log(`[getParsedDepthData] Received ${rawData.length} raw bytes from main process.`);

        // Parse the decompressed bytes
        const parsedData = parseDepthMapData(rawData);

        if (!parsedData) {
            console.error("[getParsedDepthData] Failed to parse depth map data.");
            return null;
        }
        
        console.log("[getParsedDepthData] Successfully parsed depth data (but this function is likely unused).");
        return parsedData;

    } catch (error) {
        console.error("[getParsedDepthData] Error invoking 'fetch-raw-depth-bytes' or parsing data:", error);
        return null;
    }
}

// Remove the old fetchDepthData function
/*
export async function fetchDepthData(panoId: string): Promise<DecodedDepthData | null> { ... previous implementation ... }
*/ 