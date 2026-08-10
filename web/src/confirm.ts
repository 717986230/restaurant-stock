import { reactive } from 'vue';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'default' | 'danger';
}

export const confirmState = reactive({
  open: false,
  title: '',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  tone: 'default' as 'default' | 'danger',
});

let pending: ((accepted: boolean) => void) | null = null;

export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  pending?.(false);
  Object.assign(confirmState, {
    open: true,
    title: options.title,
    message: options.message,
    confirmText: options.confirmText ?? '确定',
    cancelText: options.cancelText ?? '取消',
    tone: options.tone ?? 'default',
  });
  return new Promise((resolve) => {
    pending = resolve;
  });
}

export function settleConfirm(accepted: boolean) {
  if (!confirmState.open) return;
  confirmState.open = false;
  const resolve = pending;
  pending = null;
  resolve?.(accepted);
}

