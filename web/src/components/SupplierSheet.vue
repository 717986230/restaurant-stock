<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { api, type Supplier } from '@/api';
import { toast, toastError } from '@/toast';

const props = defineProps<{ open: boolean; supplier: Supplier | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const name = ref('');
const contactName = ref('');
const phone = ref('');
const note = ref('');
const saving = ref(false);
const nameInput = ref<HTMLInputElement | null>(null);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    name.value = props.supplier?.name ?? '';
    contactName.value = props.supplier?.contactName ?? '';
    phone.value = props.supplier?.phone ?? '';
    note.value = props.supplier?.note ?? '';
    await nextTick();
    nameInput.value?.focus();
  },
);

async function submit() {
  const n = name.value.trim();
  if (!n) {
    toastError(new Error('请填供应商名称'));
    return;
  }
  saving.value = true;
  const body = {
    name: n,
    contactName: contactName.value.trim() || null,
    phone: phone.value.trim() || null,
    note: note.value.trim() || null,
  };
  try {
    if (props.supplier) {
      await api.updateSupplier(props.supplier.id, body);
    } else {
      await api.createSupplier(body);
    }
    toast('已保存');
    emit('saved');
    emit('close');
  } catch (e) {
    toastError(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" class="mask" @click.self="emit('close')">
        <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="supplier-sheet-title">
          <header>
            <strong id="supplier-sheet-title">{{ supplier ? '编辑供应商' : '新增供应商' }}</strong>
            <button class="x" @click="emit('close')" aria-label="关闭">✕</button>
          </header>

          <label class="field">
            <span>名称</span>
            <input ref="nameInput" v-model="name" class="input" placeholder="比如：老王批发" @keyup.enter="submit" />
          </label>

          <label class="field">
            <span>联系人（可不填）</span>
            <input v-model="contactName" class="input" />
          </label>

          <label class="field">
            <span>电话（可不填）</span>
            <input v-model="phone" class="input" type="tel" inputmode="tel" />
          </label>

          <label class="field">
            <span>备注（可不填）</span>
            <textarea v-model="note" class="input" rows="2" placeholder="常订货品、结账方式…"></textarea>
          </label>

          <button class="btn btn-primary btn-block" :disabled="saving" @click="submit">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-end;
}

.sheet {
  width: 100%;
  background: var(--card);
  border-radius: 18px 18px 0 0;
  padding: 18px 16px calc(18px + env(safe-area-inset-bottom));
  max-height: 88dvh;
  overflow-y: auto;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

header strong {
  font-size: 17px;
}

.x {
  font-size: 18px;
  color: var(--muted);
  padding: 4px 8px;
}

textarea.input {
  resize: vertical;
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.22s ease;
}
.sheet-enter-active .sheet,
.sheet-leave-active .sheet {
  transition: transform 0.22s ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: translateY(100%);
}
</style>
