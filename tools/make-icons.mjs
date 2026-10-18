// icons/icon.svg와 같은 모양의 PNG 아이콘을 외부 라이브러리 없이 만든다. (node tools/make-icons.mjs)
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// 512 좌표계에서의 도형 판정 (icon.svg와 동일)
function colorAt(x, y) {
  const inEllipse = (cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  if (x >= 246 && x <= 262 && y >= 96 && y <= 396) return hex('#ffffff');
  if (x >= 262 && y >= 100 && y <= 200 && x <= 262 + 130 * (1 - Math.abs(y - 150) / 50)) return hex('#f59e0b');
  if (inEllipse(256, 396, 34, 10)) return hex('#08371f');
  if (inEllipse(256, 400, 150, 36)) return hex('#22a464');
  return hex('#0f6b3f');
}

function png(size) {
  const s = 512 / size;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // 2x2 슈퍼샘플링으로 가장자리를 부드럽게
      const acc = [0, 0, 0];
      for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const c = colorAt((x + dx) * s, (y + dy) * s);
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = acc[0] / 4; raw[o + 1] = acc[1] / 4; raw[o + 2] = acc[2] / 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [192, 512]) writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), png(size));
console.log('icons written');
