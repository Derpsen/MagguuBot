<script setup lang="ts">
import { Inbox } from '@lucide/vue';
import type { Component } from 'vue';

defineProps<{
  icon?: Component;
  title: string;
  description?: string;
}>();
</script>

<template>
  <div class="empty-state-surface flex flex-col items-center justify-center px-6 py-14 text-center">
    <div class="relative">
      <div class="absolute inset-0 rounded-2xl bg-blurple/20 blur-xl" />
      <div class="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-blurple/20 bg-blurple-soft text-violet-300">
        <component :is="icon ?? Inbox" class="h-6 w-6" />
      </div>
    </div>
    <h3 class="mt-4 text-base font-semibold text-white">{{ title }}</h3>
    <p v-if="description" class="mt-1.5 max-w-md text-sm leading-relaxed text-slate-500">{{ description }}</p>
    <div v-if="$slots.default" class="mt-4">
      <slot />
    </div>
  </div>
</template>
