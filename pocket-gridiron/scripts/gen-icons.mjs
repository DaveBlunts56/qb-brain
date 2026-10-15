// Generates the PWA / home-screen icons as PNGs from a 32×32 pixel-art design.
// No dependencies: a minimal PNG encoder using node:zlib. Run: npm run icons
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("../public/icons/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const C = {
  ".": [11, 26, 18],
  g: [57, 138, 63],
  G: [63, 148, 69],
  w: [243, 243, 236],
  o: [42, 22, 10],
  b: [138, 75, 34],
  B: [168, 98, 50],
  l: [242, 232, 216],
  y: [255, 209, 102],
};

// 32×32 design: striped field, yard line, a football with laces.
function design() {
  const px = [];
  for (let y = 0; y < 32; y++) {
    const row = [];
    for (let x = 0; x < 32; x++) row.push(Math.floor(x / 4) % 2 ? "g" : "G");
    px.push(row);
  }
  for (let y = 0; y < 32; y++) { px[y][3] = "w"; px[y][28] = "w"; }
  // Football: ellipse centered at (16, 16), radii 11 x 7, tilted look via shading.
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = (x + 0.5 - 16) / 11.5;
      const dy = (y + 0.5 - 16) / 7.5;
      const d = dx * dx + dy * dy;
      if (d <= 1.0) px[y][x] = d > 0.78 ? "o" : y < 14 ? "B" : "b";
    }
  }
  // Laces.
  for (let x = 11; x <= 20; x++) px[15][x] = "l";
  for (const x of [12, 14, 16, 18, 20]) { px[14][x] = "l"; px[16][x] = "l"; }
  // Stripes at the tips.
  for (const x of [8, 9, 22, 23]) for (let y = 12; y <= 19; y++) if (px[y][x] !== "o" && px[y][x] !== "g" && px[y][x] !== "G" && px[y][x] !== "w") px[y][x] = "l";
  return px;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pad) {
  const art = design();
  const inner = size - pad * 2;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let col = C["."];
      if (x >= pad && y >= pad && x < size - pad && y < size - pad) {
        const ax = Math.floor(((x - pad) / inner) * 32);
        const ay = Math.floor(((y - pad) / inner) * 32);
        col = C[art[ay][ax]];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = col[0];
      raw[o + 1] = col[1];
      raw[o + 2] = col[2];
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const icons = [
  ["icon-180.png", 180, 0],
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  ["icon-maskable-512.png", 512, 64], // keep the art inside the maskable safe zone
];
for (const [name, size, pad] of icons) {
  writeFileSync(new URL(name, OUT), png(size, pad));
  console.log("wrote", name);
}
