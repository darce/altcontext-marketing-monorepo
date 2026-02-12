import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const DIST_DIR = './dist';
const VERBOSE = process.argv.includes('--verbose') || process.env.BUILD_VERBOSE === '1';
const COMPRESSIBLE_EXTENSIONS = new Set([
  '.html',
  '.css',
  '.js',
  '.json',
  '.svg',
  '.txt',
  '.xml'
]);

function collectFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const out: string[] = [];
  const entries = fs.readdirSync(dirPath).sort();
  for (const entry of entries) {
    const full = path.join(dirPath, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectFiles(full));
      continue;
    }
    out.push(full);
  }
  return out;
}

function isCompressible(filePath: string): boolean {
  if (filePath.endsWith('.gz') || filePath.endsWith('.br')) return false;
  return COMPRESSIBLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function compressFile(filePath: string) {
  const raw = fs.readFileSync(filePath);
  const gzip = gzipSync(raw, { level: 9 });
  const br = brotliCompressSync(raw, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT
    }
  });

  fs.writeFileSync(`${filePath}.gz`, gzip);
  fs.writeFileSync(`${filePath}.br`, br);

  return {
    raw: raw.length,
    gzip: gzip.length,
    br: br.length
  };
}

async function main() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error(`❌ Dist directory ${DIST_DIR} not found. Run build first.`);
    process.exitCode = 1;
    return;
  }

  const files = collectFiles(DIST_DIR).filter(isCompressible).sort();
  let rawBytes = 0;
  let gzipBytes = 0;
  let brBytes = 0;

  for (const file of files) {
    const result = compressFile(file);
    rawBytes += result.raw;
    gzipBytes += result.gzip;
    brBytes += result.br;
    if (VERBOSE) {
      const rel = path.relative(DIST_DIR, file);
      console.log(
        `📦 ${rel}: raw=${result.raw} gzip=${result.gzip} br=${result.br}`
      );
    }
  }

  console.log(
    `✅ Precompressed ${files.length} text assets (.gz/.br). ` +
    `Raw ${(rawBytes / 1024 / 1024).toFixed(2)} MB -> ` +
    `Gzip ${(gzipBytes / 1024 / 1024).toFixed(2)} MB, ` +
    `Brotli ${(brBytes / 1024 / 1024).toFixed(2)} MB.`
  );
}

main().catch((err) => {
  console.error('Fatal error during compression:', err);
  process.exitCode = 1;
});
