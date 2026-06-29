type Handler = (data: unknown) => void;
const handlers = new Set<Handler>();

export const messageBus = {
  emit: (data: unknown) => handlers.forEach((h) => h(data)),
  on:   (h: Handler) => { handlers.add(h); return () => { handlers.delete(h); }; },
};
