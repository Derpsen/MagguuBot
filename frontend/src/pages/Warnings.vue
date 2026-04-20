<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Trash2 } from 'lucide-vue-next';
import { api } from '../lib/api';

interface Warning {
  id: number;
  userId: string;
  username: string;
  moderatorId: string;
  moderator: string;
  reason: string | null;
  createdAt: string;
}

const warnings = ref<Warning[]>([]);
const loading = ref(true);

async function load(): Promise<void> {
  loading.value = true;
  warnings.value = await api<Warning[]>('/api/admin/warnings');
  loading.value = false;
}

async function del(id: number): Promise<void> {
  if (!confirm('Warning wirklich löschen?')) return;
  await api(`/api/admin/warnings/${id}`, { method: 'DELETE' });
  await load();
}

onMounted(load);
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold text-white">Warnings</h1>
    <p class="mt-1 text-sm text-slate-400">Alle ausgesprochenen Warnings. Löschen = Eintrag weg.</p>

    <div v-if="loading" class="mt-8 text-slate-500">Lade…</div>

    <div v-else class="mt-6 card p-0">
      <div v-if="warnings.length === 0" class="p-8 text-center text-slate-500">
        Keine Warnings aufgezeichnet.
      </div>
      <div v-else>
        <div v-for="w in warnings" :key="w.id" class="table-row">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 text-sm">
              <span class="font-medium text-white">{{ w.username }}</span>
              <span class="text-slate-500">von</span>
              <span class="text-slate-300">{{ w.moderator }}</span>
            </div>
            <div class="mt-1 truncate text-sm text-slate-300">{{ w.reason ?? 'kein Grund angegeben' }}</div>
            <div class="mt-0.5 text-xs text-slate-500">{{ new Date(w.createdAt).toLocaleString() }}</div>
          </div>
          <button class="btn-danger" @click="del(w.id)">
            <Trash2 class="h-3.5 w-3.5" />
            Löschen
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
