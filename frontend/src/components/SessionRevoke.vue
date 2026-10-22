<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import ConfirmDialog from './ConfirmDialog.vue';

const toast = useToast();
const userId = ref('');
const confirmOpen = ref(false);
const busy = ref(false);

const valid = (value: string): boolean => /^\d{17,20}$/.test(value.trim());

async function revoke(): Promise<void> {
  busy.value = true;
  try {
    await api('/api/admin/sessions/revoke', {
      method: 'POST',
      body: JSON.stringify({ userId: userId.value.trim() }),
    });
    toast.success('Sitzungen widerrufen', `Discord-ID ${userId.value.trim()} muss sich neu anmelden.`);
    userId.value = '';
  } catch (err) {
    toast.error('Widerruf fehlgeschlagen', err instanceof Error ? err.message : undefined);
  } finally {
    busy.value = false;
    confirmOpen.value = false;
  }
}
</script>

<template>
  <section class="card">
    <h2 class="mini-label">Sitzungen</h2>
    <p class="mt-2 max-w-2xl text-sm text-slate-400">
      Meldet einen Admin auf allen Geräten ab (z. B. nach Verlust eines Geräts). Die Allowlist <code>ADMIN_USER_IDS</code> bleibt unverändert.
    </p>
    <div class="mt-4 flex flex-wrap items-center gap-2">
      <input
        v-model="userId"
        class="input w-64"
        inputmode="numeric"
        placeholder="Discord-User-ID"
        aria-label="Discord-User-ID"
      />
      <button class="btn-danger" :disabled="!valid(userId) || busy" @click="confirmOpen = true">Sitzungen widerrufen</button>
    </div>
    <ConfirmDialog
      :open="confirmOpen"
      title="Sitzungen widerrufen?"
      :description="`Alle Dashboard-Sitzungen der Discord-ID ${userId.trim()} werden ungültig.`"
      confirm-label="Widerrufen"
      tone="warning"
      :busy="busy"
      @cancel="confirmOpen = false"
      @confirm="revoke"
    />
  </section>
</template>
