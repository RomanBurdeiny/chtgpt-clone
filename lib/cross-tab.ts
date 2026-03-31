const CHANNEL = "chatgpt-clone-workspace";

export function broadcastChatWorkspaceStale(): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    new BroadcastChannel(CHANNEL).postMessage("stale");
  } catch {
    /* ignore */
  }
}

export function subscribeChatWorkspaceStale(onStale: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  let bc: BroadcastChannel;
  try {
    bc = new BroadcastChannel(CHANNEL);
  } catch {
    return () => {};
  }
  bc.onmessage = () => onStale();
  return () => bc.close();
}
