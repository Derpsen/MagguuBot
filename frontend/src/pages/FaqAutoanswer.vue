<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../lib/api';

interface FaqChannel {
  id: string;
  name: string | null;
}

const channels = ref<FaqChannel[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const data = await api<{ faqAutoanswerChannels?: FaqChannel[] }>('/api/admin/channels');
    channels.value = data.faqAutoanswerChannels ?? [];
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Laden fehlgeschlagen';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold text-white">FAQ-Autoantwort</h1>
    <p class="mt-1 max-w-2xl text-sm text-slate-400">
      Kanäle, in denen der Bot Fragen mit Website-FAQs beantwortet. Nur lesbar: gesetzt über
      <code>FAQ_AUTOANSWER_CHANNEL_IDS</code> im Unraid-Template, wirksam nach Container-Neustart.
    </p>

    <div v-if="loading" class="mt-8 text-slate-400">Lade…</div>
    <p v-else-if="error" class="mt-6 border-t border-red-400/40 pt-3 text-sm text-red-400">{{ error }}</p>
    <p v-else-if="channels.length === 0" class="mt-6 border-t border-line pt-4 text-sm text-slate-400">
      Keine Kanäle gesetzt, die FAQ-Autoantwort ist aus.
    </p>
    <ul v-else class="mt-6">
      <li v-for="ch in channels" :key="ch.id" class="row text-sm">
        <span :class="ch.name ? 'text-white' : 'text-amber-300'">{{ ch.name ? `#${ch.name}` : 'Kanal nicht gefunden' }}</span>
        <code class="text-[11px] text-slate-500">{{ ch.id }}</code>
      </li>
    </ul>
  </div>
</template>
