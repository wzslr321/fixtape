// Isolated process: runtime environment and Revideo globals never alter the caller.
process.env.DISABLE_TELEMETRY = 'true';
process.env.PUPPETEER_SKIP_DOWNLOAD = '1';
process.env.FFMPEG_PATH = 'ffmpeg';
process.env.FFPROBE_PATH = 'ffprobe';
const { createRequire } = await import('node:module');
const { dirname } = await import('node:path');
const require = createRequire(import.meta.url);
const { prepareFfmpeg } = await import('./compat.mjs');
await prepareFfmpeg();
const { chromium } = await import('playwright');
const { renderVideo } = await import('@revideo/renderer');
const aliases = Object.fromEntries(['core', '2d', 'renderer', 'ui'].map(name => {
  const module = `@revideo/${name}`;
  return [module, dirname(require.resolve(`${module}/package.json`))];
}));
await renderVideo({
  projectFile: './project.tsx',
  settings: {
    outFile: 'rendered.mp4', outDir: './rendered', workers: 1, logProgress: false,
    ffmpeg: { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' },
    puppeteer: { executablePath: chromium.executablePath() },
    viteConfig: {
      root: process.cwd(), publicDir: './public', resolve: { alias: aliases },
      esbuild: { jsx: 'automatic', jsxImportSource: '@revideo/2d' },
      server: { host: '127.0.0.1' },
    },
  },
});
