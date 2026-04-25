const activeControllers = new Set();

export function registerSseController(controller) {
  if (!controller) return () => {};
  activeControllers.add(controller);
  return () => activeControllers.delete(controller);
}

export function activeSseCount() {
  return activeControllers.size;
}

export function abortActiveSse(message = 'server shutting down') {
  let count = 0;
  for (const controller of [...activeControllers]) {
    count++;
    try { controller.abort(message); } catch { try { controller.abort(); } catch {} }
  }
  return count;
}

