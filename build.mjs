import { buildHonoSvelte } from 'svelte-hono/build';

await buildHonoSvelte({
  workerEntry: './src/worker.ts',
  outDir: './build',
  components: {
    chat: './ui/Chat.svelte',
    avatarLab: './ui/AvatarLab.svelte',
    styleLab: './ui/StyleLab.svelte',
  },
  skipWorkerBundle: true,
});
