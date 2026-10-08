export type LiveMessage = { type: string; [key: string]: unknown };

export type LiveConnection = { close(): void; reconnect(): void };

export type LiveConnectionOptions = {
  path: () => string;
  onMessage: (message: LiveMessage) => void;
  onOpen?: () => void;
  onDown?: () => void;
};

const maximumBackoffMilliseconds = 10_000;
const pingIntervalMilliseconds = 25_000;

function socketUrl(path: string): string {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function parseMessage(data: unknown): LiveMessage | null {
  if (typeof data !== 'string' || data === 'pong') return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== 'object' || parsed === null || !('type' in parsed) || typeof parsed.type !== 'string') return null;
    return { ...parsed, type: parsed.type };
  } catch {
    return null;
  }
}

export function openLiveConnection(options: LiveConnectionOptions): LiveConnection {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let reconnectTimer = 0;
  let pingTimer = 0;

  const connect = () => {
    if (closed) return;
    const current = new WebSocket(socketUrl(options.path()));
    socket = current;
    current.addEventListener('open', () => {
      attempt = 0;
      window.clearInterval(pingTimer);
      pingTimer = window.setInterval(() => {
        if (current.readyState === WebSocket.OPEN) current.send('ping');
      }, pingIntervalMilliseconds);
      options.onOpen?.();
    });
    current.addEventListener('message', (event) => {
      const message = parseMessage(event.data);
      if (message?.type === 'closing') {
        current.close();
        return;
      }
      if (message) options.onMessage(message);
    });
    current.addEventListener('close', () => {
      window.clearInterval(pingTimer);
      if (socket !== current || closed) return;
      options.onDown?.();
      const delay = Math.min(maximumBackoffMilliseconds, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
      attempt += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    });
  };

  const reconnectWhenVisible = () => {
    if (document.visibilityState !== 'visible' || closed) return;
    if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
      window.clearTimeout(reconnectTimer);
      attempt = 0;
      connect();
    }
  };

  document.addEventListener('visibilitychange', reconnectWhenVisible);
  connect();

  return {
    reconnect() {
      if (closed) return;
      window.clearTimeout(reconnectTimer);
      attempt = 0;
      const previous = socket;
      socket = null;
      previous?.close(1000, 'switching');
      connect();
    },
    close() {
      closed = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(pingTimer);
      document.removeEventListener('visibilitychange', reconnectWhenVisible);
      socket?.close(1000, 'done');
    },
  };
}
