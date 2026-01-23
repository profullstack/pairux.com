#!/usr/bin/env node
/**
 * PWA Icon Generator
 * Generates PNG icons for the PWA manifest from an SVG template
 *
 * Usage: node scripts/generate-pwa-icons.mjs
 *
 * Note: Requires sharp package (pnpm add -D sharp)
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '../public/icons');

// Ensure icons directory exists
if (!existsSync(iconsDir)) {
  mkdirSync(iconsDir, { recursive: true });
}

// PairUX logo SVG template (simple geometric design)
// Blue theme matching the app (#3b82f6)
const createSvg = (size, padding = 0) => {
  const innerSize = size - padding * 2;
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = innerSize * 0.35;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="${size}" height="${size}" fill="#0f172a" rx="${size * 0.1}"/>

  <!-- Outer ring representing connection -->
  <circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="none" stroke="#3b82f6" stroke-width="${size * 0.04}"/>

  <!-- Two overlapping circles representing pair/collaboration -->
  <circle cx="${centerX - radius * 0.3}" cy="${centerY}" r="${radius * 0.5}" fill="#3b82f6" opacity="0.9"/>
  <circle cx="${centerX + radius * 0.3}" cy="${centerY}" r="${radius * 0.5}" fill="#60a5fa" opacity="0.9"/>

  <!-- Center intersection highlight -->
  <ellipse cx="${centerX}" cy="${centerY}" rx="${radius * 0.25}" ry="${radius * 0.45}" fill="#93c5fd"/>
</svg>`;
};

// Maskable icons need safe area padding (at least 10% on each side)
const createMaskableSvg = (size) => {
  return createSvg(size, size * 0.1);
};

// Icon sizes to generate
const sizes = [192, 512];

// Generate SVG files (can be converted to PNG with sharp if available)
console.log('Generating PWA icons...\n');

for (const size of sizes) {
  // Standard icon
  const svgPath = join(iconsDir, `icon-${size}x${size}.svg`);
  writeFileSync(svgPath, createSvg(size));
  console.log(`Created: ${svgPath}`);

  // Maskable icon (with safe area padding)
  const maskableSvgPath = join(iconsDir, `icon-maskable-${size}x${size}.svg`);
  writeFileSync(maskableSvgPath, createMaskableSvg(size));
  console.log(`Created: ${maskableSvgPath}`);
}

// Try to convert to PNG using sharp (optional dependency)
async function convertToPng() {
  try {
    const sharp = (await import('sharp')).default;
    console.log('\nConverting SVGs to PNGs...\n');

    for (const size of sizes) {
      // Standard icon
      const svgPath = join(iconsDir, `icon-${size}x${size}.svg`);
      const pngPath = join(iconsDir, `icon-${size}x${size}.png`);
      await sharp(svgPath).png().toFile(pngPath);
      console.log(`Converted: ${pngPath}`);

      // Maskable icon
      const maskableSvgPath = join(iconsDir, `icon-maskable-${size}x${size}.svg`);
      const maskablePngPath = join(iconsDir, `icon-maskable-${size}x${size}.png`);
      await sharp(maskableSvgPath).png().toFile(maskablePngPath);
      console.log(`Converted: ${maskablePngPath}`);
    }

    console.log('\nPNG icons generated successfully!');
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      console.log('\nNote: sharp package not found. SVG icons created but PNG conversion skipped.');
      console.log('To generate PNG icons, install sharp: pnpm add -D sharp');
      console.log('Then run this script again.\n');
      console.log('Alternatively, you can convert the SVGs manually using any image editor.');
    } else {
      console.error('Error converting to PNG:', error.message);
    }
  }
}

// Also create favicon.ico reference (SVG)
const faviconSvg = createSvg(32);
writeFileSync(join(iconsDir, 'favicon.svg'), faviconSvg);
console.log(`Created: ${join(iconsDir, 'favicon.svg')}`);

// Create apple-touch-icon (180x180)
const appleTouchSvg = createSvg(180);
writeFileSync(join(iconsDir, 'apple-touch-icon.svg'), appleTouchSvg);
console.log(`Created: ${join(iconsDir, 'apple-touch-icon.svg')}`);

await convertToPng();

console.log('\nDone! Icons are in apps/web/public/icons/');
