<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Trash2, Hash } from 'lucide-vue-next';
import { api } from '../lib/api';

interface RolePanel {
  messageId: string;
  channelId: string;
  channelName: string | null;
  title: string;
  description: string | null;
  roles: Array<{ roleId: string; roleName: string | null; label: string; emoji: string | null }>;
  updatedAt: string;
}

const rows = ref<RolePanel[]>([]);
const loading = ref(true);

async function load(): Promise<void> {
  loading.value = true;
  rows.value = await api<RolePanel[]>('/api/admin/role-panels');
  loading.value = false;
}

async function del(messageId: string): Promise<void> {
  if (!confirm('Panel + Nachricht in Discord löschen?')) return;
  await api(`/api/admin/role-panels/${messageId}`, { method: 'DELETE' });
  await load();
}

onMounted(load);
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold text-white">Role Panels</h1>
    <p class="mt-1 text-sm text-slate-400">
      Von <code>/roles-panel</code> erstellte Button-Panels. Löschen entfernt die Discord-Nachricht + den DB-Eintrag.
    </p>

    <div v-if="loading" class="mt-8 text-slate-500">Lade…</div>

    <div v-else-if="rows.length === 0" class="mt-6 card p-8 text-center text-slate-500">
      Noch keine Role-Panels.
    </div>

    <div v-else class="mt-6 space-y-3">
      <div v-for="p in rows" :key="p.messageId" class="card">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h3 class="font-semibold text-white">{{ p.title }}</h3>
            <div class="mt-1 flex items-center gap-2 text-xs text-slate-500">
              <Hash class="h-3 w-3" />
              <span>{{ p.channelName ?? p.channelId }}</span>
              <span>· {{ p.roles.length }} Rollen</span>
              <span>· {{ new Date(p.updatedAt).toLocaleDateString() }}</span>
            </div>
            <div v-if="p.description" class="mt-2 text-sm text-slate-300">{{ p.description }}</div>
            <div class="mt-3 flex flex-wrap gap-2">
              <span
                v-for="role in p.roles"
                :key="role.roleId"
                class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-slate-800 px-2.5 py-1 text-xs"
              >
                <span v-if="role.emoji">{{ role.emoji }}</span>
                <span class="font-medium text-white">{{ role.label }}</span>
                <span class="text-slate-500">→ @{{ role.roleName ?? 'deleted' }}</span>
              </span>
            </div>
          </div>
          <button class="btn-danger" @click="del(p.messageId)">
            <Trash2 class="h-3.5 w-3.5" />
            Löschen
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
