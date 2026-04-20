<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Trash2, Clock } from 'lucide-vue-next';
import { api } from '../lib/api';

interface Reminder {
  id: number;
  userId: string;
  username: string;
  channelId: string | null;
  message: string;
  dueAt: string;
  createdAt: string;
}

const rows = ref<Reminder[]>([]);
const loading = ref(true);

async function load(): Promise<void> {
  loading.value = true;
  rows.value = await api<Reminder[]>('/api/admin/reminders');
  loading.value = false;
}

async function del(id: number): Promise<void> {
  if (!confirm('Reminder löschen?')) return;
  await api(`/api/admin/reminders/${id}`, { method: 'DELETE' });
  await load();
}

function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return 'überfällig';
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `in ${d}d ${h % 24}h`;
  if (h > 0) return `in ${h}h ${m % 60}m`;
  return `in ${m}m`;
}

onMounted(load);
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold text-white">Reminders</h1>
    <p class="mt-1 text-sm text-slate-400">Alle aktiven <code>/remindme</code>-Timer.</p>

    <div v-if="loading" class="mt-8 text-slate-500">Lade…</div>

    <div v-else class="mt-6 card p-0">
      <div v-if="rows.length === 0" class="p-8 text-center text-slate-500">
        Keine aktiven Reminders.
      </div>
      <div v-else>
        <div v-for="r in rows" :key="r.id" class="table-row">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 text-sm font-medium text-white">
              <Clock class="h-4 w-4 text-slate-500" />
              {{ r.username }}
              <span class="text-xs text-slate-400">· {{ timeUntil(r.dueAt) }}</span>
            </div>
            <div class="mt-1 truncate text-sm text-slate-300">{{ r.message }}</div>
            <div class="mt-0.5 text-xs text-slate-500">
              Fällig: {{ new Date(r.dueAt).toLocaleString() }}
            </div>
          </div>
          <button class="btn-danger" @click="del(r.id)">
            <Trash2 class="h-3.5 w-3.5" />
            Löschen
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
