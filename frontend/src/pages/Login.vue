<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { AlertTriangle, LogIn, ShieldCheck } from '@lucide/vue';

const route = useRoute();
const authErrorMessages: Record<string, string> = {
  access_denied: 'Die Discord-Anmeldung wurde abgebrochen. Du kannst sie jederzeit erneut starten.',
  provider_error: 'Discord konnte die Anmeldung nicht abschließen. Bitte versuche es noch einmal.',
  provider_unavailable: 'Discord ist gerade nicht erreichbar. Bitte versuche es in einem Moment erneut.',
  code_missing: 'Die Anmeldeantwort war unvollständig. Bitte starte die Anmeldung erneut.',
  state_missing: 'Der sichere Anmelde-Cookie fehlte. Bitte starte die Anmeldung über diese Seite erneut.',
  state_mismatch: 'Diese Anmeldeantwort gehört zu einem älteren oder anderen Tab. Bitte starte sie erneut.',
  token_exchange: 'Der Discord-Anmeldecode konnte nicht eingelöst werden. Bitte versuche es erneut.',
  profile_fetch: 'Dein Discord-Profil konnte nicht geladen werden. Bitte versuche es erneut.',
  profile_invalid: 'Discord hat ein unerwartetes Profil geliefert. Bitte versuche es erneut.',
  not_allowed: 'Dein Discord-Account steht nicht in ADMIN_USER_IDS und darf dieses Dashboard nicht öffnen.',
};

const next = computed(() => typeof route.query.next === 'string' ? route.query.next : '/');
const loginUrl = computed(() => `/auth/login?next=${encodeURIComponent(next.value)}`);
const authError = computed(() => {
  if (typeof route.query.authError !== 'string') return null;
  return authErrorMessages[route.query.authError]
    ?? 'Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuche es erneut.';
});
</script>

<template>
  <div class="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface-0 p-4">
    <div class="absolute inset-0 opacity-40 pointer-events-none">
      <div class="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-blurple/30 blur-3xl" />
      <div class="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-purple-600/20 blur-3xl" />
    </div>

    <div class="relative w-full max-w-md">
      <div class="card text-center">
        <div class="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-blurple text-2xl font-bold text-white shadow-pop">
          M
        </div>
        <h1 class="text-2xl font-semibold tracking-tight text-white">MagguuBot Dashboard</h1>
        <p class="mt-2 text-sm text-slate-400">
          Sign in with Discord to manage your bot.
        </p>

        <div
          v-if="authError"
          class="mt-5 flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-left text-amber-200"
          role="alert"
        >
          <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
          <p class="text-xs leading-relaxed">{{ authError }}</p>
        </div>

        <a :href="loginUrl" class="btn-primary mt-6 w-full">
          <LogIn class="h-4 w-4" />
          Mit Discord einloggen
        </a>

        <div class="mt-6 flex items-start gap-2 rounded-lg border border-line bg-surface-2/60 p-3 text-left">
          <ShieldCheck class="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <p class="text-xs text-slate-400">
            Nur auf der <code>ADMIN_USER_IDS</code>-Allowlist eingetragene Discord-Accounts haben Zugriff. Nach erfolgreicher Anmeldung bleibst du auf diesem Gerät bis zu 30 Tage angemeldet.
          </p>
        </div>
      </div>

      <p class="mt-4 text-center text-xs text-slate-600">
        MagguuBot · Built for homelabs
      </p>
    </div>
  </div>
</template>
