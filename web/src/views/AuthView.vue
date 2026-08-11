<script setup lang="ts">
import { computed, ref } from 'vue';
import { api, currentUser } from '@/api';
import { deriveKey } from '@/crypto';

const emit = defineEmits<{ done: [] }>();

const mode = ref<'login' | 'register'>('login');
const username = ref('');
const password = ref('');
const password2 = ref('');
const invite = ref('');
const showPassword = ref(false);
const busy = ref(false);
const error = ref('');

const isRegister = computed(() => mode.value === 'register');

function validate(): string | null {
  const name = username.value.trim();
  if (!/^[a-zA-Z0-9_一-龥]{2,20}$/.test(name)) return '用户名 2-20 位，只能用中文、字母、数字和下划线';
  if (password.value.length < 6) return '密码至少 6 位';
  if (!isRegister.value) return null;
  if (!invite.value.trim()) return '请填邀请码';
  if (password.value !== password2.value) return '两次输入的密码不一样';
  return null;
}

async function submit() {
  if (busy.value) return;
  const problem = validate();
  if (problem) {
    error.value = problem;
    return;
  }

  busy.value = true;
  error.value = '';
  try {
    const name = username.value.trim();
    // 这一步在手机上跑 60 万次迭代，约 0.2~0.5 秒，明文密码不出这台设备
    const key = await deriveKey(name, password.value);
    const res = isRegister.value
      ? await api.register(name, key, invite.value.trim())
      : await api.login(name, key);
    currentUser.value = res.user;
    emit('done');
  } catch (e) {
    error.value = e instanceof Error ? e.message : '出错了，请重试';
  } finally {
    busy.value = false;
  }
}

function switchMode() {
  mode.value = isRegister.value ? 'login' : 'register';
  error.value = '';
  password2.value = '';
  invite.value = '';
}
</script>

<template>
  <div class="auth">
    <div class="box">
      <div class="logo">📦</div>
      <h1>门店库存</h1>
      <p class="muted small sub">进货、出库、盘点，一部手机搞定</p>

      <div class="tabs">
        <button :class="{ on: !isRegister }" @click="mode = 'login'">登录</button>
        <button :class="{ on: isRegister }" @click="mode = 'register'">注册</button>
      </div>

      <form @submit.prevent="submit">
        <label class="field">
          <span>用户名</span>
          <input
            v-model="username"
            class="input"
            autocomplete="username"
            autocapitalize="none"
            autocorrect="off"
            :placeholder="isRegister ? '给自己起一个，比如 老王川菜' : '你的用户名'"
          />
        </label>

        <label class="field">
          <span>密码</span>
          <div class="pw">
            <input
              v-model="password"
              class="input"
              :type="showPassword ? 'text' : 'password'"
              :autocomplete="isRegister ? 'new-password' : 'current-password'"
              placeholder="至少 6 位"
            />
            <button type="button" class="eye" @click="showPassword = !showPassword">
              {{ showPassword ? '隐藏' : '显示' }}
            </button>
          </div>
        </label>

        <label v-if="isRegister" class="field">
          <span>再输一次密码</span>
          <input
            v-model="password2"
            class="input"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
          />
        </label>

        <label v-if="isRegister" class="field">
          <span>邀请码</span>
          <input v-model="invite" class="input" autocapitalize="none" autocorrect="off" placeholder="向管理员索取" />
        </label>

        <p v-if="error" class="err">{{ error }}</p>

        <button class="btn btn-primary btn-block" type="submit" :disabled="busy">
          {{ busy ? (isRegister ? '正在创建…' : '正在登录…') : isRegister ? '注册并开始用' : '登录' }}
        </button>
      </form>

      <p class="muted small foot">
        <template v-if="isRegister">
          注册需要邀请码，注册后会自动铺好 48 项常备物料。<br />
          已经有账号了？
          <button class="link" @click="switchMode">去登录</button>
        </template>
        <template v-else>
          还没有账号？
          <button class="link" @click="switchMode">注册一个</button>
          <br />登录后这台手机会记住 90 天
        </template>
      </p>

      <p class="muted tiny">
        密码在你手机上加密后才发出去，服务器存不到你的原始密码。<br />
        每个账号的库存数据互相独立，别人看不到你的。
      </p>
    </div>
  </div>
</template>

<style scoped>
.auth {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 20px calc(24px + env(safe-area-inset-bottom));
  background: var(--bg);
}

.box {
  width: 100%;
  max-width: 380px;
  text-align: center;
}

.logo {
  font-size: 44px;
  line-height: 1;
}

h1 {
  margin: 10px 0 4px;
  font-size: 22px;
  font-weight: 650;
}

.sub {
  margin: 0 0 22px;
}

.tabs {
  display: flex;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 4px;
  margin-bottom: 20px;
}

.tabs button {
  flex: 1;
  padding: 9px 0;
  border-radius: 9px;
  font-size: 15px;
  color: var(--muted);
}

.tabs button.on {
  background: var(--brand);
  color: #fff;
  font-weight: 600;
}

.field {
  text-align: left;
}

.pw {
  position: relative;
}

.pw .input {
  padding-right: 60px;
}

.eye {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  padding: 8px 10px;
  font-size: 13px;
  color: var(--muted);
}

.err {
  margin: 0 0 12px;
  color: var(--danger);
  font-size: 14px;
  text-align: left;
}

.foot {
  margin: 18px 0 0;
  line-height: 1.9;
}

.link {
  color: var(--brand);
  font-weight: 600;
  font-size: 13px;
  padding: 0;
}

.tiny {
  margin-top: 20px;
  font-size: 11.5px;
  line-height: 1.8;
  opacity: 0.75;
}
</style>
