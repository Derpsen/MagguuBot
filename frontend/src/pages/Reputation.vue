<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Heart } from 'lucide-vue-next';
import { api } from '../lib/api';

interface RepRow {
  userId: string;
  username: string;
  rep: number;
}

const rows = ref<RepRow[]>([]);
const loading = ref(true);

onMounted(async () => {
  rows.value = await api<RepRow[]>('/api/admin/reputation');
  loading.value = false;
});
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold text-white">Reputation</h1>
    <p class="mt-1 text-sm text-slate-400">Top 50 nach gesammeltem rep (via <code>/rep give</code>).</p>

    <div v-if="loading" class="mt-8 text-slate-500">Lade…</div>

    <div v-else class="mt-6 card p-0">
      <div v-if="rows.length === 0" class="p-8 text-center text-slate-500">
        Noch keine Rep vergeben.
      </div>
      <div v-else>
        <div v-for="(r, i) in rows" :key="r.userId" class="table-row">
          <div class="flex items-center gap-4">
            <div class="w-8 text-center text-lg font-bold text-slate-500">{{ i + 1 }}</div>
            <div>
              <div class="text-sm font-medium text-white">{{ r.username }}</div>
              <div class="text-xs text-slate-500"><code>{{ r.userId }}</code></div>
            </div>
          </div>
          <div class="flex items-center gap-1.5 text-sm font-semibold text-pink-400">
            <Heart class="h-4 w-4 fill-current" />
            {{ r.rep }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
