import { clearTimeout, setTimeout } from "node:timers";

export type AdvisoryRead<T> = { available: true; value: T } | { available: false };

// Only for optional information. Never use a deadline to authorize a mutation.
export const readAdvisory = async <T>(read: () => Promise<T>, timeoutMs: number): Promise<AdvisoryRead<T>> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read).then((value) => ({ available: true as const, value }), () => ({ available: false as const })),
      new Promise<AdvisoryRead<T>>((done) => { timer = setTimeout(() => done({ available: false }), timeoutMs); })
    ]);
  } finally { clearTimeout(timer); }
};
