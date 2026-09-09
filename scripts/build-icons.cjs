// Convert existing vector artwork into a Windows ICO; no new artwork or dependencies.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

(async () => {
  const sizes = [16, 32, 48, 64, 128, 256];
  const source = path.join(__dirname, '../assets/icon.svg');
  const images = await Promise.all(sizes.map(size => sharp(source).resize(size, size).png().toBuffer()));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); // ICO image type
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  images.forEach((data, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  await fs.writeFile(path.join(__dirname, '../assets/icon.ico'), Buffer.concat([header, ...images]));
})().catch(error => { console.error(error); process.exitCode = 1; });
