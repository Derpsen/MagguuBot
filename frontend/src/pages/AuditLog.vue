<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../lib/api';

interface AuditEntry {
  id: number;
  userId: string;
  action: string;
  target: string | null;
  detail: unknown;
  ip: string | null;
  createdAt: string;
}

const entries = ref<AuditEntry[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

function formatDetail(detail: unknown): string {
  if (detail === null || detail === undefined || detail === '') return '';
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return '';
  }
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    entries.value = await api<AuditEntry[]>('/api/admin/audit-log?limit=200');
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
    <h1 class="text-2xl font-semibold text-white">Audit-Log</h1>
    <p class="mt-1 text-sm text-slate-400">Änderungen über dieses Dashboard, neueste zuerst (max. 200).</p>

    <div v-if="loading" class="mt-8 text-slate-400">Lade…</div>
    <p v-else-if="error" class="mt-6 border-t border-red-400/40 pt-3 text-sm text-red-400">{{ error }}</p>
    <p v-else-if="entries.length === 0" class="mt-6 border-t border-line pt-4 text-sm text-slate-400">Noch keine Einträge.</p>
    <div v-else class="mt-6 overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="border-b border-line">
            <th class="mini-label py-2 pr-4 font-medium">Zeit</th>
            <th class="mini-label py-2 pr-4 font-medium">Aktion</th>
            <th class="mini-label py-2 pr-4 font-medium">Ziel</th>
            <th class="mini-label py-2 pr-4 font-medium">Nutzer</th>
            <th class="mini-label py-2 font-medium">Details</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in entries" :key="e.id" class="border-b border-line hover:bg-white/[0.03]">
            <td class="whitespace-nowrap py-2 pr-4 text-xs text-slate-400">{{ new Date(e.createdAt).toLocaleString() }}</td>
            <td class="py-2 pr-4 font-mono text-xs text-white">{{ e.action }}</td>
            <td class="py-2 pr-4 text-xs text-silver-300">{{ e.target ?? '—' }}</td>
            <td class="py-2 pr-4 font-mono text-[11px] text-slate-400">{{ e.userId }}</td>
            <td class="max-w-md truncate py-2 font-mono text-[11px] text-slate-500" :title="formatDetail(e.detail)">{{ formatDetail(e.detail) || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
