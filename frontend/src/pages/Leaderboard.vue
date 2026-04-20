<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../lib/api';

interface XpRow {
  userId: string;
  username: string;
  xp: number;
  level: number;
  messagesCounted: number;
}

const rows = ref<XpRow[]>([]);
const loading = ref(true);

onMounted(async () => {
  rows.value = await api<XpRow[]>('/api/admin/xp');
  loading.value = false;
});
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold text-white">XP-Leaderboard</h1>
    <p class="mt-1 text-sm text-slate-400">Top 50 nach gesammeltem XP.</p>

    <div v-if="loading" class="mt-8 text-slate-500">Lade…</div>

    <div v-else class="mt-6 card p-0">
      <div v-if="rows.length === 0" class="p-8 text-center text-slate-500">
        Noch keine XP vergeben.
      </div>
      <div v-else>
        <div v-for="(r, i) in rows" :key="r.userId" class="table-row">
          <div class="flex items-center gap-4">
            <div class="w-8 text-center text-lg font-bold text-slate-500">{{ i + 1 }}</div>
            <div>
              <div class="text-sm font-medium text-white">{{ r.username }}</div>
              <div class="text-xs text-slate-500">{{ r.messagesCounted }} Messages · <code>{{ r.userId }}</code></div>
            </div>
          </div>
          <div class="text-right">
            <div class="text-sm font-semibold text-white">Lv {{ r.level }}</div>
            <div class="text-xs text-slate-400">{{ r.xp.toLocaleString() }} XP</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
