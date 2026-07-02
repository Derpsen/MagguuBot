import { ref } from 'vue';
import { api } from '../lib/api';

export interface SessionUser {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
}

const user = ref<SessionUser | null>(null);
const loaded = ref(false);

async function refresh(): Promise<void> {
  try {
    const me = await api<SessionUser | null>('/api/admin/me');
    user.value = me;
  } catch {
    user.value = null;
  } finally {
    loaded.value = true;
  }
}

async function logout(): Promise<void> {
  try {
    await api('/api/admin/logout', { method: 'POST' });
  } finally {
    user.value = null;
    loaded.value = true;
    window.location.assign('/login');
  }
}

export function useSession() {
  return { user, loaded, refresh, logout };
}
