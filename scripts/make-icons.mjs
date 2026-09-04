// Renders public/icons/icon.svg to the PNG sizes the manifest needs.
// Uses sharp (already present as a Next.js dependency).
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const svg = readFileSync(new URL("../public/icons/icon.svg", import.meta.url));

const targets = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["apple-touch-icon.png", 180, false],
  ["icon-maskable-512.png", 512, true],
];

for (const [name, size, maskable] of targets) {
  let img = sharp(svg, { density: 384 }).resize(maskable ? Math.round(size * 0.8) : size, maskable ? Math.round(size * 0.8) : size);
  if (maskable) {
    const inner = await img.png().toBuffer();
    img = sharp({ create: { width: size, height: size, channels: 4, background: "#0b1610" } }).composite([{ input: inner, gravity: "centre" }]);
  }
  const out = await img.png().toBuffer();
  writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), out);
  console.log("wrote", name, out.length, "bytes");
}
