import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition, openBrowser } from '@remotion/renderer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? '/tmp/vo/video-muted.mp4';

const bundled = await bundle({
  entryPoint: path.resolve(__dirname, '../src/index.ts'),
  webpackOverride: (config) => config,
});

const browser = await openBrowser('chrome', {
  browserExecutable: process.env.PUPPETEER_EXECUTABLE_PATH ?? '/bin/chromium',
  chromiumOptions: { args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] },
  chromeMode: 'chrome-for-testing',
});

const composition = await selectComposition({ serveUrl: bundled, id: 'main', puppeteerInstance: browser });

await renderMedia({
  composition,
  serveUrl: bundled,
  codec: 'h264',
  outputLocation: out,
  puppeteerInstance: browser,
  muted: true,
  concurrency: 8,
  onProgress: ({ progress }) => {
    if (Math.round(progress * 100) % 10 === 0) console.log('progress', Math.round(progress * 100));
  },
});

await browser.close({ silent: false });
console.log('done', out);
