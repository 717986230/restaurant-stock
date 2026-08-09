import { ref } from 'vue';

export const toastState = ref<{ text: string; error: boolean } | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

function show(text: string, error: boolean) {
  toastState.value = { text, error };
  clearTimeout(timer);
  timer = setTimeout(() => (toastState.value = null), error ? 3200 : 1800);
}

export function toast(text: string) {
  show(text, false);
}

export function toastError(e: unknown) {
  show(e instanceof Error ? e.message : String(e), true);
}
