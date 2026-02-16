// offline-scripts/generate-mocks.ts
import fs from "node:fs";
import path from "node:path";

const SOURCE_DIR = "./input-images/celebs";
const MOCK_DIR = "./input-images/mocks";

const XMP_TEMPLATE = (name: string, yaw: number, pitch: number) => `
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description
      xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
      xmlns:acx="http://alt-context.dev/ns/1.0/">

      <Iptc4xmpExt:ImageRegion>
        <rdf:Bag>
          <rdf:li>
            <Iptc4xmpExt:RegionBoundary>
              <Iptc4xmpExt:rbShape>rectangle</Iptc4xmpExt:rbShape>
              <Iptc4xmpExt:rbX>0.3</Iptc4xmpExt:rbX>
              <Iptc4xmpExt:rbY>0.2</Iptc4xmpExt:rbY>
              <Iptc4xmpExt:rbW>0.4</Iptc4xmpExt:rbW>
              <Iptc4xmpExt:rbH>0.5</Iptc4xmpExt:rbH>
              <Iptc4xmpExt:rbUnit>relative</Iptc4xmpExt:rbUnit>
            </Iptc4xmpExt:RegionBoundary>
            <Iptc4xmpExt:Name>${name}</Iptc4xmpExt:Name>

            <acx:Pitch>${pitch.toFixed(1)}</acx:Pitch>
            <acx:Yaw>${yaw.toFixed(1)}</acx:Yaw>
            <acx:Roll>0.0</acx:Roll>
            <acx:DetScore>0.99</acx:DetScore>
          </rdf:li>
        </rdf:Bag>
      </Iptc4xmpExt:ImageRegion>

    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
`;

function injectXmp(inputPath: string, outputPath: string, xmp: string) {
  const buffer = fs.readFileSync(inputPath);
  const xmpHeader = Buffer.from("http://ns.adobe.com/xap/1.0/\0");
  const xmpContent = Buffer.from(xmp, "utf8");

  // APP1 header (0xFFE1) + Length (2 bytes)
  const segmentLength = 2 + xmpHeader.length + xmpContent.length;
  const app1Header = Buffer.alloc(4);
  app1Header[0] = 0xff;
  app1Header[1] = 0xe1;
  app1Header.writeUInt16BE(segmentLength, 2);

  // Find insertion point (after SOI 0xFFD8)
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    // Not a standard JPEG start, just append or prepend?
    // For simplicity, let's just create a new buffer if it's not JPEG.
    // But most of our files are JPG.
  }

  const newBuffer = Buffer.concat([
    buffer.slice(0, 2), // SOI
    app1Header,
    xmpHeader,
    xmpContent,
    buffer.slice(2),
  ]);

  fs.writeFileSync(outputPath, newBuffer);
}

function generateMocks() {
  if (!fs.existsSync(MOCK_DIR)) fs.mkdirSync(MOCK_DIR, { recursive: true });

  const sourceFiles = fs
    .readdirSync(SOURCE_DIR)
    .filter((f) => f.endsWith(".jpg"))
    .slice(0, 25);

  console.log(`🔨 Generating ${sourceFiles.length} mock images...`);

  let i = 0;
  for (let py = -2; py <= 2; py++) {
    for (let y = -2; y <= 2; y++) {
      if (i >= sourceFiles.length) break;

      const file = sourceFiles[i];
      const yaw = y * 30; // -60, -30, 0, 30, 60
      const pitch = py * 20; // -40, -20, 0, 20, 40

      const xmp = XMP_TEMPLATE("Daniel", yaw, pitch);
      const inputPath = path.join(SOURCE_DIR, file);
      const outputPath = path.join(MOCK_DIR, `mock_${i}.jpg`);

      injectXmp(inputPath, outputPath, xmp);
      i++;
    }
  }

  console.log(`✅ Done! Created ${i} mock images in ${MOCK_DIR}`);
}

generateMocks();
