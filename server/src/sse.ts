import type { Response } from "express";
import type { SSEEvent } from "@chat/shared";

// Opens an SSE stream on the response and returns a typed sender + closer.
export function openSSE(res: Response): {
  send: (event: SSEEvent) => void;
  close: () => void;
} {
  res.socket?.setNoDelay(true);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  return {
    send(event: SSEEvent) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    close() {
      res.end();
    },
  };
}
