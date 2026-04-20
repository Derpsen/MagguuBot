<script setup lang="ts">
import { useRoute } from 'vue-router';
import { LogIn, ShieldCheck } from 'lucide-vue-next';

const route = useRoute();
const next = typeof route.query.next === 'string' ? route.query.next : '/';
const loginUrl = `/auth/login?next=${encodeURIComponent(next)}`;
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

        <a :href="loginUrl" class="btn-primary mt-6 w-full">
          <LogIn class="h-4 w-4" />
          Mit Discord einloggen
        </a>

        <div class="mt-6 flex items-start gap-2 rounded-lg border border-line bg-surface-2/60 p-3 text-left">
          <ShieldCheck class="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
          <p class="text-xs text-slate-400">
            Nur auf der <code>ADMIN_USER_IDS</code>-Allowlist eingetragene Discord-Accounts haben Zugriff. Nicht-Admins werden nach dem Login mit einer Fehlerseite abgewiesen.
          </p>
        </div>
      </div>

      <p class="mt-4 text-center text-xs text-slate-600">
        MagguuBot · Built for homelabs
      </p>
    </div>
  </div>
</template>
