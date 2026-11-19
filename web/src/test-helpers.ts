import type { ProjectDocument } from './types';

export function setupTestEnvironment() {
  const sessionStore = new Map<string, string>();
  (globalThis as any).sessionStorage = {
    getItem: (k: string) => sessionStore.get(k) ?? null,
    setItem: (k: string, v: string) => sessionStore.set(k, String(v)),
    removeItem: (k: string) => sessionStore.delete(k),
    clear: () => sessionStore.clear(),
  };

  const idbStore = new Map<string, any>();
  const mockDb = {
    createObjectStore: () => {},
    close: () => {},
    transaction: () => {
      const tx: any = {
        objectStore: () => ({
          put: (val: any, key: string) => {
            idbStore.set(key, val);
            const req: any = {};
            setTimeout(() => { req.onsuccess?.({target:{result:key}}); tx.oncomplete?.(); }, 0);
            return req;
          },
          get: (key: string) => {
            const req: any = {};
            setTimeout(() => {
              req.result = idbStore.get(key);
              req.onsuccess && req.onsuccess({ target: { result: req.result } });
            }, 0);
            return req;
          },
        }),
      };
      return tx;
    },
  };

  (globalThis as any).indexedDB = {
    open: () => {
      const openReq: any = {
        result: mockDb,
      };
      setTimeout(() => {
        if (openReq.onupgradeneeded) openReq.onupgradeneeded({ target: openReq });
        if (openReq.onsuccess) openReq.onsuccess({ target: openReq });
      }, 0);
      return openReq;
    },
  };

  if (typeof globalThis.document === 'undefined') {
    const mockCtx = {
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      drawImage: () => {},
    };
    const mockCanvas = {
      width: 96,
      height: 96,
      dataset: {},
      getContext: () => mockCtx,
      toDataURL: (type = 'image/png') =>
        `data:${type};base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`,
      toBlob: (cb: (b: Blob | null) => void, type = 'image/png') => {
        cb(new Blob(['mock-png-data'], { type }));
      },
    };
    (globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag === 'canvas') return { ...mockCanvas };
        if (tag === 'a') return { href: '', download: '', click: () => {} };
        if (tag === 'input') return { type: '', accept: '', click: () => {}, onchange: null };
        return {
          className: '',
          textContent: '',
          title: '',
          dataset: {},
          style: {},
          append: () => {},
          replaceChildren: () => {},
          onclick: null,
        };
      },
      getElementById: () => null,
    };
    (globalThis as any).URL = {
      createObjectURL: () => 'blob:mock-url',
      revokeObjectURL: () => {},
    };
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0);
  }

  return { sessionStore, idbStore };
}
