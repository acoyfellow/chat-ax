export function localModelReply(prompt: string): string {
  const quoted = prompt.trim().replace(/\s+/g, ' ').slice(0, 120);
  return [
    `You said: "${quoted}"`,
    '',
    'This reply comes from the built-in local test model, so you can try Chat AX without any model access. Deploy to Cloudflare, or run `npm run dev`, to talk to real models.',
  ].join('\n');
}
