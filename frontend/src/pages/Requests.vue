<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Check, X, Film, Tv } from 'lucide-vue-next';
import { api } from '../lib/api';

interface SeerrRequest {
  id: number;
  seerrRequestId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  status: 'pending' | 'approved' | 'declined' | 'available' | 'failed' | 'deleted';
  requestedBy: string | null;
  createdAt: string;
}

const rows = ref<SeerrRequest[]>([]);
const loading = ref(true);
const busy = ref<number | null>(null);

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  approved: 'bg-green-500/20 text-green-400',
  declined: 'bg-red-500/20 text-red-400',
  available: 'bg-emerald-500/20 text-emerald-400',
  failed: 'bg-red-500/20 text-red-400',
  deleted: 'bg-slate-500/20 text-slate-400',
};

async function load(): Promise<void> {
  loading.value = true;
  rows.value = await api<SeerrRequest[]>('/api/admin/seerr');
  loading.value = false;
}

async function approve(id: number): Promise<void> {
  busy.value = id;
  try {
    await api(`/api/admin/seerr/${id}/approve`, { method: 'POST' });
    await load();
  } finally {
    busy.value = null;
  }
}

async function decline(id: number): Promise<void> {
  busy.value = id;
  try {
    await api(`/api/admin/seerr/${id}/decline`, { method: 'POST' });
    await load();
  } finally {
    busy.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold text-white">Seerr Requests</h1>
    <p class="mt-1 text-sm text-slate-400">Pending Requests approve/decline — genauso wie die Discord-Buttons.</p>

    <div v-if="loading" class="mt-8 text-slate-500">Lade…</div>

    <div v-else class="mt-6 card p-0">
      <div v-if="rows.length === 0" class="p-8 text-center text-slate-500">
        Noch keine Requests.
      </div>
      <div v-else>
        <div v-for="r in rows" :key="r.id" class="table-row">
          <div class="flex min-w-0 flex-1 items-center gap-3">
            <component
              :is="r.mediaType === 'movie' ? Film : Tv"
              class="h-5 w-5 flex-shrink-0 text-slate-500"
            />
            <div class="min-w-0">
              <div class="truncate text-sm font-medium text-white">{{ r.title }}</div>
              <div class="text-xs text-slate-500">
                #{{ r.seerrRequestId }} · {{ r.requestedBy ?? 'unknown' }} · {{ new Date(r.createdAt).toLocaleDateString() }}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span
              class="rounded-md px-2 py-0.5 text-xs font-medium"
              :class="STATUS_COLOR[r.status]"
            >
              {{ r.status }}
            </span>
            <template v-if="r.status === 'pending'">
              <button
                class="btn-primary bg-green-600 hover:bg-green-700"
                :disabled="busy === r.seerrRequestId"
                @click="approve(r.seerrRequestId)"
              >
                <Check class="h-3.5 w-3.5" />
                Approve
              </button>
              <button
                class="btn-danger"
                :disabled="busy === r.seerrRequestId"
                @click="decline(r.seerrRequestId)"
              >
                <X class="h-3.5 w-3.5" />
                Decline
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
