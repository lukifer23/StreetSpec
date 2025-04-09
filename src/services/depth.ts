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
 * 
 * @param panoId The panorama ID.
 * @returns A Promise resolving to the parsed depth data, or null if fetching/parsing fails.
 */
// Make the outer function async
export async function getParsedDepthData(panoId: string): Promise<DecodedDepthData | null> {
    console.log(`Requesting depth data for panoId: ${panoId} via IPC.`);
    
    try {
        // Request raw bytes from main process via IPC
        const rawData: Uint8Array | null = await window.electronAPI.fetchDepthData(panoId);

        if (!rawData) {
            console.error("Received null data from main process for depth map.");
            return null;
        }

        console.log(`Received ${rawData.length} raw bytes from main process.`);

        // Parse the decompressed bytes
        const parsedData = parseDepthMapData(rawData);

        if (!parsedData) {
            console.error("Failed to parse depth map data.");
            return null;
        }
        
        console.log("Successfully parsed depth data.");
        return parsedData;

    } catch (error) {
        console.error("Error getting/parsing depth data:", error);
        return null;
    }
}

// Remove the old fetchDepthData function
/*
export async function fetchDepthData(panoId: string): Promise<DecodedDepthData | null> { ... previous implementation ... }
*/ 