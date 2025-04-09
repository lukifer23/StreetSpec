import { DepthPlane, DecodedDepthData } from '../types/common';

// --- Helper functions for parsing binary data ---
function readUInt16LE(buffer: Uint8Array, offset: number): number {
    const view = new DataView(buffer.buffer, buffer.byteOffset);
    return view.getUint16(offset, true);
}

function readFloat32LE(buffer: Uint8Array, offset: number): number {
    const view = new DataView(buffer.buffer, buffer.byteOffset);
    return view.getFloat32(offset, true);
}
// --- End Helper Functions ---

function parseDepthMapData(decompressedBytes: Uint8Array): DecodedDepthData | null {
    try {
        const headerSize = decompressedBytes[0];
        if (headerSize !== 8) {
            console.warn("Unexpected depth map header size:", headerSize);
        }
        const numberOfPlanes = readUInt16LE(decompressedBytes, 1);
        const width = readUInt16LE(decompressedBytes, 3);
        const height = readUInt16LE(decompressedBytes, 5);
        const planeDataOffset = readUInt16LE(decompressedBytes, 7);

        console.log("Parsed Header:", { headerSize, numberOfPlanes, width, height, planeDataOffset });

        if (width !== 512 || height !== 256) {
            console.warn(`Unexpected depth map dimensions: ${width}x${height}`);
        }

        const indicesStart = headerSize;
        const indicesLength = width * height;
        const indices = new Uint8Array(decompressedBytes.buffer, decompressedBytes.byteOffset + indicesStart, indicesLength);

        const planes: DepthPlane[] = [];
        for (let i = 0; i < numberOfPlanes; i++) {
            const planeOffset = planeDataOffset + i * 16;
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

export async function getParsedDepthData(panoId: string): Promise<DecodedDepthData | null> {
    console.log(`Requesting depth data for panoId: ${panoId} via IPC.`);
    
    try {
        const rawData: Uint8Array | null = await window.electronAPI.fetchDepthData(panoId);

        if (!rawData) {
            console.error("Received null data from main process for depth map.");
            return null;
        }

        console.log(`Received ${rawData.length} raw bytes from main process.`);

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
