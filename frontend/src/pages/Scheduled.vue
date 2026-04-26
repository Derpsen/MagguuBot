<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Trash2, Calendar, Repeat } from 'lucide-vue-next';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';

type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';

interface Scheduled {
  id: number;
  channelId: string;
  title: string;
  message: string;
  color: string;
  fireAt: string;
  fired: boolean;
  recurrence: Recurrence;
  lastFiredAt: string | null;
  createdAt: string;
}

const rows = ref<Scheduled[]>([]);
const loading = ref(true);
const toast = useToast();

async function load(): Promise<void> {
  loading.value = true;
  rows.value = await api<Scheduled[]>('/api/admin/scheduled');
  loading.value = false;
}

async function del(id: number): Promise<void> {
  if (!confirm('Scheduled announcement löschen?')) return;
  await api(`/api/admin/scheduled/${id}`, { method: 'DELETE' });
  await load();
}

async function setRecurrence(id: number, recurrence: Recurrence): Promise<void> {
  try {
    await api(`/api/admin/scheduled/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ recurrence }),
    });
    toast.success('Aktualisiert', 'Wiederholung gespeichert.');
    await load();
  } catch {
    toast.error('Fehler', 'Konnte Wiederholung nicht speichern.');
  }
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
    <h1 class="text-2xl font-semibold text-white">Scheduled Announcements</h1>
    <p class="mt-1 text-sm text-slate-400">
      Von <code>/schedule-announce</code> angelegte geplante Posts. Scheduler feuert alle 30s.
    </p>

    <div v-if="loading" class="mt-8 text-slate-500">Lade…</div>

    <div v-else class="mt-6 card p-0">
      <div v-if="rows.length === 0" class="p-8 text-center text-slate-500">
        Keine geplanten Announcements.
      </div>
      <div v-else>
        <div v-for="r in rows" :key="r.id" class="table-row">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <Calendar class="h-4 w-4 text-slate-500" />
              <span class="text-sm font-medium text-white">{{ r.title }}</span>
              <span v-if="r.recurrence !== 'none'" class="inline-flex items-center gap-1 rounded bg-blurple/20 px-2 py-0.5 text-xs text-blurple">
                <Repeat class="h-3 w-3" />
                {{ r.recurrence }}
              </span>
              <span v-if="r.fired && r.recurrence === 'none'" class="rounded bg-green-500/20 px-2 py-0.5 text-xs text-green-400">
                gesendet
              </span>
              <span v-else class="rounded bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-400">
                {{ r.recurrence !== 'none' ? `nächste ${timeUntil(r.fireAt)}` : timeUntil(r.fireAt) }}
              </span>
            </div>
            <div class="mt-1 truncate text-sm text-slate-400">{{ r.message }}</div>
            <div class="mt-0.5 text-xs text-slate-500">
              {{ new Date(r.fireAt).toLocaleString() }} · #{{ r.channelId }}
              <span v-if="r.lastFiredAt"> · zuletzt {{ new Date(r.lastFiredAt).toLocaleString() }}</span>
            </div>
          </div>
          <select
            :value="r.recurrence"
            @change="setRecurrence(r.id, ($event.target as HTMLSelectElement).value as Recurrence)"
            class="rounded-lg border border-border bg-slate-900 px-2 py-1 text-xs text-white focus:border-blurple focus:outline-none"
          >
            <option value="none">einmalig</option>
            <option value="daily">täglich</option>
            <option value="weekly">wöchentlich</option>
            <option value="monthly">monatlich</option>
          </select>
          <button class="btn-danger" @click="del(r.id)">
            <Trash2 class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
