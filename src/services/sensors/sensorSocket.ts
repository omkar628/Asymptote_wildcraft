async function socketPayloadText(data: unknown): Promise<string | null> {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data.buffer);
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return data.text();
  }
  if (typeof data === 'object' && data !== null) {
    try {
      return JSON.stringify(data);
    } catch {
      return null;
    }
  }
  return null;
}

export type SocketHandlers = {
  onPhase: (phase: 'connecting' | 'connected' | 'disconnected') => void;
  onMessage: (raw: string) => void;
};

/** Reconnect until stop() is called. The phone does not open COM6. */
export function openSensorSocket(url: string, handlers: SocketHandlers): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let delay = 1000;
  let loggedClose = false;

  const open = () => {
    if (stopped) {
      return;
    }
    handlers.onPhase('connecting');
    const next = new WebSocket(url);
    socket = next;
    next.onopen = () => {
      if (stopped || socket !== next) {
        return;
      }
      delay = 1000;
      handlers.onPhase('connected');
    };
    next.onmessage = (event) => {
      if (stopped || socket !== next) {
        return;
      }
      void socketPayloadText(event.data).then((text) => {
        if (stopped || socket !== next || text == null) {
          return;
        }
        handlers.onMessage(text);
      });
    };
    next.onerror = () => {
      // onclose follows and schedules the retry.
    };
    next.onclose = () => {
      if (socket !== next) {
        return;
      }
      if (stopped) {
        handlers.onPhase('disconnected');
        return;
      }
      handlers.onPhase('disconnected');
      if (!loggedClose) {
        loggedClose = true;
        console.warn(`[wildcraft] WebSocket closed: ${url}`);
      }
      retry = setTimeout(open, delay);
      delay = Math.min(delay * 2, 15000);
    };
  };

  open();

  return () => {
    stopped = true;
    if (retry) {
      clearTimeout(retry);
    }
    const current = socket;
    socket = null;
    current?.close();
  };
}
