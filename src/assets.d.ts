declare module '*.png?url' {
  const url: string;
  export default url;
}

declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component<Record<string, unknown>>;
  export default component;
}
