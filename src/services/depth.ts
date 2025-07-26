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
            return null;
        }
        const numberOfPlanes = readUInt16LE(decompressedBytes, 1);
        const width = readUInt16LE(decompressedBytes, 3);
        const height = readUInt16LE(decompressedBytes, 5);
        const planeDataOffset = readUInt16LE(decompressedBytes, 7);

        if (width !== 512 || height !== 256) {
            return null;
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

        return {
            planes,
            indices,
            width,
            height
        };
    } catch (error) {
        return null;
    }
}

export async function getParsedDepthData(panoId: string): Promise<DecodedDepthData | null> {
    try {
        const rawData: Uint8Array | null = await window.electronAPI.invoke('fetch-depth-data', panoId);

        if (!rawData) {
            return null;
        }

        const parsedData = parseDepthMapData(rawData);

        if (!parsedData) {
            return null;
        }
        
        return parsedData;

    } catch (error) {
        return null;
    }
}
