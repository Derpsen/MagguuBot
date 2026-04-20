<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Hash, Check } from 'lucide-vue-next';
import { api } from '../lib/api';

interface Mapping {
  key: string;
  label: string;
  description: string;
  channelId: string | null;
  channelName: string | null;
}

interface AvailableChannel {
  id: string;
  name: string;
  parentName: string | null;
}

const mappings = ref<Mapping[]>([]);
const available = ref<AvailableChannel[]>([]);
const loading = ref(true);
const savingKey = ref<string | null>(null);
const savedKey = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  const data = await api<{ mappings: Mapping[]; available: AvailableChannel[] }>('/api/admin/channels');
  mappings.value = data.mappings;
  available.value = data.available;
  loading.value = false;
}

async function update(key: string, channelId: string): Promise<void> {
  if (!channelId) return;
  savingKey.value = key;
  try {
    await api(`/api/admin/channels/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ channelId }),
    });
    savedKey.value = key;
    setTimeout(() => (savedKey.value = null), 2000);
    await load();
  } finally {
    savingKey.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold text-white">Channel-Mapping</h1>
    <p class="mt-1 text-sm text-slate-400">
      Welcher Discord-Channel empfängt welche Events. Wird auch von <code>/setup-server</code> gepflegt.
    </p>

    <div v-if="loading" class="mt-8 text-slate-500">Lade…</div>

    <div v-else class="mt-6 grid gap-3">
      <div v-for="m in mappings" :key="m.key" class="card">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <Hash class="h-4 w-4 text-slate-500" />
              <h3 class="font-semibold text-white">{{ m.label }}</h3>
              <code class="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">{{ m.key }}</code>
            </div>
            <p class="mt-1 text-xs text-slate-500">{{ m.description }}</p>
          </div>
          <div class="flex items-center gap-2">
            <select
              :value="m.channelId ?? ''"
              class="rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white focus:border-blurple focus:outline-none"
              @change="(e) => update(m.key, (e.target as HTMLSelectElement).value)"
            >
              <option value="" disabled>— wähle Channel —</option>
              <option v-for="ch in available" :key="ch.id" :value="ch.id">
                {{ ch.parentName ? `[${ch.parentName}] ` : '' }}#{{ ch.name }}
              </option>
            </select>
            <Check v-if="savedKey === m.key" class="h-5 w-5 text-green-400" />
            <span v-else-if="savingKey === m.key" class="text-xs text-slate-500">…</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
