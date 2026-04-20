<script setup lang="ts">
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-vue-next';
import { useToast } from '../composables/useToast';

const { toasts, remove } = useToast();

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warn: AlertTriangle,
};

const STYLES = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  error: 'border-red-500/30 bg-red-500/10 text-red-300',
  info: 'border-blurple/30 bg-blurple-soft text-slate-100',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
} as const;
</script>

<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
      <transition-group
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 translate-x-4"
        enter-to-class="opacity-100 translate-x-0"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 translate-x-0"
        leave-to-class="opacity-0 translate-x-4"
      >
        <div
          v-for="t in toasts"
          :key="t.id"
          class="pointer-events-auto flex items-start gap-3 rounded-xl border bg-surface-1 p-3.5 shadow-pop backdrop-blur"
          :class="STYLES[t.kind]"
        >
          <component :is="ICONS[t.kind]" class="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div class="min-w-0 flex-1">
            <div class="text-sm font-semibold">{{ t.title }}</div>
            <div v-if="t.description" class="mt-0.5 text-xs opacity-80">{{ t.description }}</div>
          </div>
          <button class="text-slate-400 hover:text-white" @click="remove(t.id)">
            <X class="h-3.5 w-3.5" />
          </button>
        </div>
      </transition-group>
    </div>
  </Teleport>
</template>
