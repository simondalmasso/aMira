// Analyze a pasted image with the z-ai-web-dev-sdk vision model.
// Output is printed to stdout (description + any transcribed text).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ZAI from 'z-ai-web-dev-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGE_PATH = '/home/z/my-project/upload/pasted_image_1782940987235.png';
const PROMPT =
  'Describe en español qué muestra esta imagen. Si contiene texto, transcríbelo literalmente.';

function toBase64DataUrl(filePath) {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType =
    ext === '.png'
      ? 'image/png'
      : ext === '.webp'
        ? 'image/webp'
        : ext === '.gif'
          ? 'image/gif'
          : ext === '.bmp'
            ? 'image/bmp'
            : 'image/jpeg';
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

async function main() {
  if (!fs.existsSync(IMAGE_PATH)) {
    throw new Error(`Image not found: ${IMAGE_PATH}`);
  }

  const dataUrl = toBase64DataUrl(IMAGE_PATH);
  const zai = await ZAI.create();

  const response = await zai.chat.completions.createVision({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    thinking: { type: 'disabled' },
  });

  const content = response?.choices?.[0]?.message?.content ?? '';
  console.log('=== VLM ANALYSIS RESULT ===');
  console.log(content);
  console.log('=== END ===');
}

main().catch((err) => {
  console.error('VLM analysis failed:', err);
  process.exit(1);
});
