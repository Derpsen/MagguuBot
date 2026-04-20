<script setup lang="ts">
import { Inbox } from 'lucide-vue-next';
import type { Component } from 'vue';

defineProps<{
  icon?: Component;
  title: string;
  description?: string;
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center px-6 py-12 text-center">
    <div class="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-slate-500">
      <component :is="icon ?? Inbox" class="h-6 w-6" />
    </div>
    <h3 class="mt-3 text-sm font-semibold text-slate-200">{{ title }}</h3>
    <p v-if="description" class="mt-1 max-w-sm text-xs text-slate-500">{{ description }}</p>
    <div class="mt-4">
      <slot />
    </div>
  </div>
</template>
