type Handler = (data: unknown) => void;
const handlers = new Set<Handler>();

export const messageBus = {
  emit: (data: unknown) => handlers.forEach((h) => h(data)),
  /** Subscribe. Returns an unsubscribe function. */
  on:   (h: Handler) => { handlers.add(h); return () => { handlers.delete(h); }; },
  /** Explicit off (alternative to calling the returned unsubscribe fn). */
  off:  (h: Handler) => { handlers.delete(h); },
};
