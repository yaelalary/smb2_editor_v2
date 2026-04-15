<script setup lang="ts">
/**
 * Shared button used across toolbars, dialogs, and actions.
 *
 * Variants:
 *   - primary:   main call-to-action (Load ROM, Download, Export project)
 *   - secondary: neutral action (Cancel, Back)
 *   - danger:    destructive (Reset level, Delete)
 *   - ghost:     low-emphasis inline action (close dialog)
 */

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

const props = withDefaults(
  defineProps<{
    variant?: Variant;
    size?: Size;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    ariaLabel?: string;
  }>(),
  {
    variant: 'secondary',
    size: 'md',
    disabled: false,
    type: 'button',
    ariaLabel: undefined,
  },
);

defineEmits<{ (e: 'click', event: MouseEvent): void }>();

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-hover focus-visible:outline-accent',
  secondary:
    'bg-panel text-ink border border-panel-border hover:bg-panel-subtle focus-visible:outline-accent',
  danger:
    'bg-status-danger text-white hover:brightness-95 focus-visible:outline-status-danger',
  ghost:
    'bg-transparent text-ink-muted hover:text-ink hover:bg-panel-subtle focus-visible:outline-accent',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-sm',
  md: 'px-4 py-2 text-sm',
};
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    :aria-label="ariaLabel"
    :class="[
      'inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors',
      'focus-visible:outline-2 focus-visible:outline-offset-2',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      variantClasses[props.variant],
      sizeClasses[props.size],
    ]"
    @click="(event) => $emit('click', event)"
  >
    <slot />
  </button>
</template>
