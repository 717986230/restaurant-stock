import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { ApiError, type Env } from './types';

const COOKIE_NAME = 'rs_session';
/** 90 天免登录：后厨的手机不该每天都来一遍 PIN */
const SESSION_DAYS = 90;

/** 连错这么多次就锁一段时间。6 位 PIN 共 100 万种，配上锁定基本猜不动。 */
const MAX_FAILS = 5;
const BLOCK_MINUTES = 10;

const encoder = new TextEncoder();

/** 逐字节比较，耗时与"错在第几位"无关，不给旁路计时留线索 */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}

async function sign(pin: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(pin), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 会话令牌是「过期时间 + 用 PIN 签的名」，服务端不存任何会话记录。
 * 副作用正好是想要的：改了 PIN，所有旧手机上的登录状态立刻失效。
 */
async function issueToken(pin: string): Promise<string> {
  const exp = String(Date.now() + SESSION_DAYS * 86400_000);
  return `${exp}.${await sign(pin, exp)}`;
}

async function tokenValid(pin: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const exp = token.slice(0, dot);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return timingSafeEqual(token.slice(dot + 1), await sign(pin, exp));
}

function requirePin(env: Env): string {
  const pin = env.APP_PIN;
  // 宁可整站报错，也不能因为忘了配密码就悄悄变成谁都能进
  if (!pin) throw new ApiError(500, '服务端还没有设置 APP_PIN，请先执行 wrangler secret put APP_PIN');
  return pin;
}

function clientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  return c.req.header('cf-connecting-ip') ?? 'unknown';
}

/** 登录、退出之外的所有接口都要带上有效 Cookie */
export const requireAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/api/login' || path === '/api/logout' || path === '/api/session') return next();

  const pin = requirePin(c.env);
  if (!(await tokenValid(pin, getCookie(c, COOKIE_NAME)))) {
    throw new ApiError(401, '请先输入 PIN');
  }
  return next();
};

export function registerAuthRoutes(app: import('hono').Hono<{ Bindings: Env }>) {
  /** 前端启动时问一句：这台手机还认不认得 */
  app.get('/api/session', async (c) => {
    const configured = Boolean(c.env.APP_PIN);
    const ok = configured && (await tokenValid(c.env.APP_PIN!, getCookie(c, COOKIE_NAME)));
    return c.json({ ok, configured });
  });

  app.post('/api/login', async (c) => {
    const pin = requirePin(c.env);
    const ip = clientIp(c);

    const guard = await c.env.DB.prepare('select fails, blocked_until from login_guard where ip = ?')
      .bind(ip)
      .first<{ fails: number; blocked_until: string | null }>();
    if (guard?.blocked_until && guard.blocked_until > new Date().toISOString()) {
      const mins = Math.ceil((Date.parse(guard.blocked_until) - Date.now()) / 60000);
      throw new ApiError(429, `输错太多次了，请 ${mins} 分钟后再试`);
    }

    const body = await c.req.json<{ pin?: unknown }>().catch(() => ({ pin: '' }));
    const input = typeof body.pin === 'string' ? body.pin : '';

    if (!timingSafeEqual(input, pin)) {
      const fails = (guard?.fails ?? 0) + 1;
      const blockedUntil = fails >= MAX_FAILS ? new Date(Date.now() + BLOCK_MINUTES * 60_000).toISOString() : null;
      await c.env.DB.prepare(
        `insert into login_guard (ip, fails, blocked_until, updated_at)
         values (?, ?, ?, datetime('now'))
         on conflict (ip) do update set fails = excluded.fails, blocked_until = excluded.blocked_until,
                                        updated_at = excluded.updated_at`,
      )
        .bind(ip, fails, blockedUntil)
        .run();
      // 顺手清掉一天前的记录，这张表不该越长越大
      await c.env.DB.prepare("delete from login_guard where updated_at < datetime('now', '-1 day')").run();

      const left = MAX_FAILS - fails;
      throw new ApiError(401, left > 0 ? `PIN 不对，还可以试 ${left} 次` : `输错太多次了，请 ${BLOCK_MINUTES} 分钟后再试`);
    }

    await c.env.DB.prepare('delete from login_guard where ip = ?').bind(ip).run();

    setCookie(c, COOKIE_NAME, await issueToken(pin), {
      httpOnly: true,
      // 本地 http://localhost 调试时不能带 Secure，否则浏览器直接丢弃
      secure: new URL(c.req.url).protocol === 'https:',
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_DAYS * 86400,
    });
    return c.json({ ok: true });
  });

  app.post('/api/logout', (c) => {
    deleteCookie(c, COOKIE_NAME, { path: '/' });
    return c.json({ ok: true });
  });
}
