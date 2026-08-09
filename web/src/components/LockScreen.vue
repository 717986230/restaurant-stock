<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { api } from '@/api';

const emit = defineEmits<{ unlocked: [] }>();

const PIN_LENGTH = 6;

const pin = ref('');
const error = ref('');
const checking = ref(false);
const input = ref<HTMLInputElement | null>(null);

onMounted(() => input.value?.focus());

/**
 * 底下藏着一个真正的 input 负责唤起数字键盘，上面画 6 个格子做显示。
 * 这样既能用系统键盘和粘贴，又能拿到想要的样子。
 */
async function onInput() {
  pin.value = pin.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
  error.value = '';
  if (pin.value.length === PIN_LENGTH) await submit();
}

async function submit() {
  if (pin.value.length !== PIN_LENGTH || checking.value) return;
  checking.value = true;
  try {
    await api.login(pin.value);
    emit('unlocked');
  } catch (e) {
    error.value = e instanceof Error ? e.message : '登录失败';
    pin.value = '';
    await nextTick();
    input.value?.focus();
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <div class="lock">
    <div class="box">
      <div class="logo">📦</div>
      <h1>门店库存</h1>
      <p class="muted small">请输入 6 位 PIN</p>

      <div class="cells" @click="input?.focus()">
        <span v-for="i in PIN_LENGTH" :key="i" :class="['cell', { filled: pin.length >= i, active: pin.length === i - 1 }]">
          {{ pin.length >= i ? '●' : '' }}
        </span>
      </div>

      <input
        ref="input"
        v-model="pin"
        class="hidden-input"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        :maxlength="PIN_LENGTH"
        @input="onInput"
        @keyup.enter="submit"
      />

      <p v-if="checking" class="muted small state">验证中…</p>
      <p v-else-if="error" class="err state">{{ error }}</p>
      <p v-else class="muted small state">这台手机会记住 90 天</p>
    </div>
  </div>
</template>

<style scoped>
.lock {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.box {
  width: 100%;
  max-width: 340px;
  text-align: center;
}

.logo {
  font-size: 44px;
  line-height: 1;
}

h1 {
  margin: 12px 0 4px;
  font-size: 21px;
  font-weight: 650;
}

.cells {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin: 26px 0 14px;
}

.cell {
  width: 42px;
  height: 52px;
  border-radius: 11px;
  border: 1px solid var(--line);
  background: var(--card);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: var(--text);
}

.cell.filled {
  border-color: var(--brand);
}

.cell.active {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

/* 不能用 display:none / visibility:hidden，否则 iOS 不会弹出键盘 */
.hidden-input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
  border: 0;
  padding: 0;
}

.state {
  margin: 0;
  min-height: 20px;
}

.err {
  margin: 0;
  color: var(--danger);
  font-size: 14px;
}
</style>
