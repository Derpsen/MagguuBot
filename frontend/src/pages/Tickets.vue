<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Lock, Ticket } from 'lucide-vue-next';
import { api } from '../lib/api';

interface TicketRow {
  id: number;
  channelId: string;
  opener: string;
  openerId: string;
  topic: string | null;
  open: boolean;
  createdAt: string;
  closedAt: string | null;
}

const rows = ref<TicketRow[]>([]);
const loading = ref(true);

async function load(): Promise<void> {
  loading.value = true;
  rows.value = await api<TicketRow[]>('/api/admin/tickets');
  loading.value = false;
}

async function close(id: number): Promise<void> {
  if (!confirm('Ticket schließen? Channel wird gelöscht.')) return;
  await api(`/api/admin/tickets/${id}/close`, { method: 'POST' });
  await load();
}

onMounted(load);
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold text-white">Tickets</h1>
    <p class="mt-1 text-sm text-slate-400">Offene + geschlossene Support-Tickets.</p>

    <div v-if="loading" class="mt-8 text-slate-500">Lade…</div>

    <div v-else class="mt-6 card p-0">
      <div v-if="rows.length === 0" class="p-8 text-center text-slate-500">
        Noch keine Tickets. Erstelle ein Panel mit <code>/ticket-panel</code>.
      </div>
      <div v-else>
        <div v-for="t in rows" :key="t.id" class="table-row">
          <div class="flex min-w-0 flex-1 items-center gap-3">
            <Ticket class="h-5 w-5 flex-shrink-0" :class="t.open ? 'text-blurple' : 'text-slate-600'" />
            <div class="min-w-0">
              <div class="text-sm font-medium text-white">#{{ t.id }} — {{ t.opener }}</div>
              <div class="text-xs text-slate-500">
                {{ new Date(t.createdAt).toLocaleString() }}
                <span v-if="t.closedAt"> · geschlossen {{ new Date(t.closedAt).toLocaleString() }}</span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span
              class="rounded-md px-2 py-0.5 text-xs font-medium"
              :class="t.open ? 'bg-blurple/20 text-blurple' : 'bg-slate-500/20 text-slate-400'"
            >
              {{ t.open ? 'offen' : 'geschlossen' }}
            </span>
            <button v-if="t.open" class="btn-danger" @click="close(t.id)">
              <Lock class="h-3.5 w-3.5" />
              Schließen
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
