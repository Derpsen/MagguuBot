<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../lib/api';

interface WebhookEvent {
  id: number;
  source: string;
  eventType: string;
  status: string;
  error: string | null;
  createdAt: string;
}

const rows = ref<WebhookEvent[]>([]);
const loading = ref(true);

const STATUS_COLOR: Record<string, string> = {
  posted: 'bg-green-500/20 text-green-400',
  skipped: 'bg-slate-500/20 text-slate-400',
  failed: 'bg-red-500/20 text-red-400',
};

const SOURCE_EMOJI: Record<string, string> = {
  sonarr: '📺',
  radarr: '🎬',
  seerr: '🙏',
  tautulli: '✨',
  sabnzbd: '📦',
  github: '🔨',
  maintainerr: '🗑️',
};

onMounted(async () => {
  rows.value = await api<WebhookEvent[]>('/api/admin/webhooks');
  loading.value = false;
});
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold text-white">Webhooks</h1>
    <p class="mt-1 text-sm text-slate-400">Die letzten 100 Events, die der Bot empfangen hat.</p>

    <div v-if="loading" class="mt-8 text-slate-500">Lade…</div>

    <div v-else class="mt-6 card p-0">
      <div v-if="rows.length === 0" class="p-8 text-center text-slate-500">
        Noch keine Webhooks empfangen.
      </div>
      <div v-else>
        <div v-for="r in rows" :key="r.id" class="table-row">
          <div class="flex items-center gap-3">
            <span class="text-lg">{{ SOURCE_EMOJI[r.source] ?? '🔔' }}</span>
            <div>
              <div class="text-sm font-medium text-white">
                {{ r.source }} · <span class="text-slate-400">{{ r.eventType }}</span>
              </div>
              <div v-if="r.error" class="mt-0.5 text-xs text-red-400">{{ r.error }}</div>
              <div class="text-xs text-slate-500">{{ new Date(r.createdAt).toLocaleString() }}</div>
            </div>
          </div>
          <span class="rounded-md px-2 py-0.5 text-xs font-medium" :class="STATUS_COLOR[r.status] ?? 'bg-slate-500/20 text-slate-400'">
            {{ r.status }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
