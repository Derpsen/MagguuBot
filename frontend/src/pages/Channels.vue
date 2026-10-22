<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Check } from '@lucide/vue';
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

const GROUPS: Array<{ title: string; keys: string[] }> = [
  { title: 'Start & Community', keys: ['welcome', 'movieNight', 'starboard'] },
  { title: 'MagguuUI', keys: ['addonUpdates', 'blizzard', 'faq', 'suggestions'] },
  { title: 'Plex', keys: ['requests', 'newOnPlex', 'weeklyDigest', 'downloadLive', 'grabs', 'imports', 'plexActivity'] },
  { title: 'Admin', keys: ['approvals', 'failures', 'health', 'github', 'modLog', 'auditLog', 'ticketLogs'] },
];

const grouped = computed(() => {
  const known = new Set(GROUPS.flatMap((g) => g.keys));
  const groups = GROUPS.map((g) => ({
    title: g.title,
    items: g.keys
      .map((key) => mappings.value.find((m) => m.key === key))
      .filter((m): m is Mapping => Boolean(m)),
  }));
  const rest = mappings.value.filter((m) => !known.has(m.key));
  if (rest.length) groups.push({ title: 'Weitere', items: rest });
  return groups.filter((g) => g.items.length > 0);
});

/** Mapped to an ID that no longer exists as a text channel in the guild. */
function isOrphan(m: Mapping): boolean {
  return m.channelId !== null && m.channelName === null;
}

const orphanCount = computed(() => mappings.value.filter(isOrphan).length);

onMounted(load);
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold text-white">Kanal-Zuordnung</h1>
    <p class="mt-1 text-sm text-slate-400">
      Welcher Discord-Kanal welche Events empfängt. Mehrere Einträge dürfen auf denselben Kanal zeigen. Wird auch von <code>/setup-server</code> gepflegt.
    </p>
    <p v-if="!loading && orphanCount > 0" class="mt-4 border-t border-amber-300/40 pt-3 text-sm text-amber-300" role="alert">
      {{ orphanCount }} Zuordnung(en) zeigen auf einen Kanal, den es im Server nicht mehr gibt. Bitte neu zuordnen.
    </p>

    <div v-if="loading" class="mt-8 text-slate-400">Lade…</div>

    <div v-else class="mt-6 space-y-8">
      <section v-for="group in grouped" :key="group.title">
        <p class="mini-label">{{ group.title }}</p>
        <ul class="mt-2">
          <li v-for="m in group.items" :key="m.key" class="row flex-wrap">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-white">{{ m.label }}</span>
                <code class="text-[11px] text-slate-500">{{ m.key }}</code>
              </div>
              <p class="mt-0.5 text-xs text-slate-400">{{ m.description }}</p>
              <p v-if="isOrphan(m)" class="mt-0.5 text-xs text-amber-300">Kanal {{ m.channelId }} nicht gefunden</p>
            </div>
            <div class="flex items-center gap-2">
              <select
                :value="m.channelId ?? ''"
                class="input w-72 max-w-full"
                :aria-label="`Kanal für ${m.label}`"
                @change="(e) => update(m.key, (e.target as HTMLSelectElement).value)"
              >
                <option value="" disabled>— Kanal wählen —</option>
                <option v-for="ch in available" :key="ch.id" :value="ch.id">
                  {{ ch.parentName ? `[${ch.parentName}] ` : '' }}#{{ ch.name }}
                </option>
              </select>
              <Check v-if="savedKey === m.key" class="h-4 w-4 text-brand-300" />
              <span v-else-if="savingKey === m.key" class="text-xs text-slate-400">…</span>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
