import { reactive } from 'vue';

export type ToastKind = 'success' | 'error' | 'info' | 'warn';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
  timeoutId?: number;
}

const state = reactive<{ toasts: Toast[] }>({ toasts: [] });
let nextId = 1;

export function useToast() {
  function push(kind: ToastKind, title: string, description?: string, ms = 3500): void {
    const id = nextId++;
    const toast: Toast = { id, kind, title, description };
    state.toasts.push(toast);
    toast.timeoutId = window.setTimeout(() => remove(id), ms);
  }

  function remove(id: number): void {
    const i = state.toasts.findIndex((t) => t.id === id);
    if (i >= 0) {
      const t = state.toasts[i];
      if (t?.timeoutId) window.clearTimeout(t.timeoutId);
      state.toasts.splice(i, 1);
    }
  }

  return {
    toasts: state.toasts,
    success: (title: string, description?: string) => push('success', title, description),
    error: (title: string, description?: string) => push('error', title, description, 5000),
    info: (title: string, description?: string) => push('info', title, description),
    warn: (title: string, description?: string) => push('warn', title, description, 5000),
    remove,
  };
}
