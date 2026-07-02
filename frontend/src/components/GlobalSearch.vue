<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Search, LoaderCircle } from '@lucide/vue';
import { useRouter } from 'vue-router';
import { api } from '../lib/api';

interface SearchResult {
  kind: 'user' | 'request' | 'ticket' | 'warning' | 'webhook';
  label: string;
  description: string;
  to: string;
}

const router = useRouter();
const query = ref('');
const results = ref<SearchResult[]>([]);
const loading = ref(false);
const focused = ref(false);
const input = ref<HTMLInputElement | null>(null);
let timer: number | null = null;
let requestId = 0;

const open = computed(() => focused.value && query.value.trim().length >= 2);

watch(query, () => {
  if (timer !== null) window.clearTimeout(timer);
  const value = query.value.trim();
  if (value.length < 2) {
    results.value = [];
    loading.value = false;
    return;
  }
  timer = window.setTimeout(() => void search(value), 250);
});

async function search(value: string): Promise<void> {
  const current = ++requestId;
  loading.value = true;
  try {
    const response = await api<{ results: SearchResult[] }>(`/api/admin/search?q=${encodeURIComponent(value)}`);
    if (current === requestId) results.value = response.results;
  } catch {
    if (current === requestId) results.value = [];
  } finally {
    if (current === requestId) loading.value = false;
  }
}

async function select(result: SearchResult): Promise<void> {
  query.value = '';
  focused.value = false;
  await router.push(result.to);
}

function handleShortcut(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    input.value?.focus();
  }
  if (event.key === 'Escape') input.value?.blur();
}

function handleBlur(): void {
  window.setTimeout(() => { focused.value = false; }, 150);
}

onMounted(() => window.addEventListener('keydown', handleShortcut));
onUnmounted(() => {
  window.removeEventListener('keydown', handleShortcut);
  if (timer !== null) window.clearTimeout(timer);
});
</script>

<template>
  <div class="relative ml-auto hidden w-full max-w-sm md:block">
    <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
    <input
      ref="input"
      v-model="query"
      type="search"
      placeholder="Suchen …"
      class="h-8 w-full rounded-lg border border-line bg-surface-2 pl-9 pr-14 text-sm text-slate-200 outline-none transition focus:border-blurple/60"
      @focus="focused = true"
      @blur="handleBlur"
    />
    <span class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 py-0.5 text-[10px] text-slate-500">⌘K</span>
    <div v-if="open" class="absolute right-0 top-full z-50 mt-2 max-h-96 w-full overflow-y-auto rounded-xl border border-line bg-surface-1 p-1.5 shadow-pop">
      <div v-if="loading" class="flex items-center justify-center gap-2 px-3 py-5 text-sm text-slate-500">
        <LoaderCircle class="h-4 w-4 animate-spin" /> Suche …
      </div>
      <template v-else>
        <button
          v-for="result in results"
          :key="`${result.kind}:${result.label}:${result.description}`"
          class="block w-full rounded-lg px-3 py-2 text-left hover:bg-surface-3"
          @mousedown.prevent="select(result)"
        >
          <div class="truncate text-sm font-medium text-slate-100">{{ result.label }}</div>
          <div class="truncate text-xs text-slate-500">{{ result.description }}</div>
        </button>
      </template>
      <div v-if="!loading && results.length === 0" class="px-3 py-5 text-center text-sm text-slate-500">Keine Treffer</div>
    </div>
  </div>
</template>
