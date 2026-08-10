import type { Hono, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { SEED_ITEMS } from './seed';
import { ApiError, type AppEnv, type Env } from './types';

const COOKIE_NAME = 'rs_session';
/** 90 天免登录：后厨的手机不该每天都来一遍密码 */
const SESSION_DAYS = 90;

/**
 * 服务端这一层迭代次数不高，是被免费版 Workers「每请求 10ms CPU」卡住的。
 * 真正的强度放在手机上做（见 web/src/crypto.ts，60 万次迭代），
 * 服务端收到的已经是派生结果而不是明文密码，两层加起来 62 万次，
 * 攻击者就算拖走整个库，每猜一次密码也要付这么多算力。
 */
const SERVER_ITERATIONS = 20_000;

/** 连错这么多次就锁一段时间 */
const MAX_FAILS = 8;
const BLOCK_MINUTES = 10;

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)).buffer);
}

/** 逐字节比较，耗时与"错在第几位"无关，不给旁路计时留线索 */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}

async function derive(clientKey: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(clientKey), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return toHex(bits);
}

async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function clientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  return c.req.header('cf-connecting-ip') ?? 'unknown';
}

function sessionCookieOptions(url: string) {
  return {
    httpOnly: true,
    // 本地 http://localhost 调试时不能带 Secure，否则浏览器直接丢弃
    secure: new URL(url).protocol === 'https:',
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  };
}

/**
 * 手机发过来的是 PBKDF2 派生结果（64 位十六进制），不是明文密码。
 * 这里校验格式，顺带挡住"直接把明文当 key 发过来"的坏客户端。
 */
function requireClientKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new ApiError(400, '密码格式不对，请在本应用页面内登录');
  }
  return value;
}

function requireUsername(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9_一-龥]{2,20}$/.test(raw)) {
    throw new ApiError(400, '用户名 2-20 位，只能用中文、字母、数字和下划线');
  }
  return raw;
}

async function throttle(c: { env: Env; req: { header: (k: string) => string | undefined } }) {
  const ip = clientIp(c);
  const row = await c.env.DB.prepare('select fails, blocked_until from login_guard where ip = ?')
    .bind(ip)
    .first<{ fails: number; blocked_until: string | null }>();
  if (row?.blocked_until && row.blocked_until > new Date().toISOString()) {
    const mins = Math.ceil((Date.parse(row.blocked_until) - Date.now()) / 60000);
    throw new ApiError(429, `尝试太多次了，请 ${mins} 分钟后再试`);
  }
  return { ip, fails: row?.fails ?? 0 };
}

async function recordFail(env: Env, ip: string, fails: number): Promise<number> {
  const next = fails + 1;
  const blockedUntil = next >= MAX_FAILS ? new Date(Date.now() + BLOCK_MINUTES * 60_000).toISOString() : null;
  await env.DB.batch([
    env.DB.prepare(
      `insert into login_guard (ip, fails, blocked_until, updated_at)
       values (?, ?, ?, datetime('now'))
       on conflict (ip) do update set fails = excluded.fails, blocked_until = excluded.blocked_until,
                                      updated_at = excluded.updated_at`,
    ).bind(ip, next, blockedUntil),
    // 顺手清掉一天前的记录，这张表不该越长越大
    env.DB.prepare("delete from login_guard where updated_at < datetime('now', '-1 day')"),
  ]);
  return MAX_FAILS - next;
}

async function startSession(env: Env, userId: number, userAgent: string | null): Promise<string> {
  const token = randomHex(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await env.DB.batch([
    // 库里只存令牌的哈希：即使数据库内容外泄，也没法拿去冒充登录
    env.DB.prepare(
      `insert into sessions (token_hash, user_id, expires_at, user_agent, last_seen_at)
       values (?, ?, ?, ?, datetime('now'))`,
    ).bind(
      await sha256Hex(token),
      userId,
      expires,
      userAgent,
    ),
    env.DB.prepare("delete from sessions where expires_at < datetime('now')"),
  ]);
  return token;
}

/** 登录、注册之外的所有接口都要带上有效会话 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/api/register' || path === '/api/login' || path === '/api/logout' || path === '/api/me') {
    return next();
  }

  const token = getCookie(c, COOKIE_NAME);
  if (!token) throw new ApiError(401, '请先登录');

  const row = await c.env.DB.prepare(
    `select s.user_id from sessions s where s.token_hash = ? and s.expires_at > datetime('now')`,
  )
    .bind(await sha256Hex(token))
    .first<{ user_id: number }>();
  if (!row) throw new ApiError(401, '登录已过期，请重新登录');

  c.set('userId', row.user_id);
  return next();
};

export function registerAuthRoutes(app: Hono<AppEnv>) {
  /** 前端启动时问一句：这台手机还认不认得 */
  app.get('/api/me', async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) return c.json({ ok: false });
    const row = await c.env.DB.prepare(
      `select u.id, u.username, u.display_name, coalesce(us.currency, 'EUR') as currency from sessions s
       join users u on u.id = s.user_id
       left join user_settings us on us.user_id = u.id
       where s.token_hash = ? and s.expires_at > datetime('now')`,
    )
      .bind(await sha256Hex(token))
      .first<{ id: number; username: string; display_name: string; currency: string }>();
    if (!row) return c.json({ ok: false });
    return c.json({ ok: true, user: { id: row.id, username: row.username, displayName: row.display_name, currency: row.currency } });
  });

  app.post('/api/register', async (c) => {
    const { ip, fails } = await throttle(c);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const displayName = requireUsername(body.username);
    const username = displayName.toLowerCase();
    const clientKey = requireClientKey(body.key);

    const exists = await c.env.DB.prepare('select id from users where username = ?')
      .bind(username)
      .first<{ id: number }>();
    if (exists) {
      await recordFail(c.env, ip, fails);
      throw new ApiError(409, '这个用户名已经被注册了');
    }

    const salt = randomHex(16);
    const passHash = await derive(clientKey, salt, SERVER_ITERATIONS);
    const res = await c.env.DB.prepare(
      'insert into users (username, display_name, salt, pass_hash, iterations) values (?, ?, ?, ?, ?)',
    )
      .bind(username, displayName, salt, passHash, SERVER_ITERATIONS)
      .run();

    const userId = Number(res.meta.last_row_id);
    // 新账号先铺一套常备物料，省得对着空列表一件件手输
    await c.env.DB.batch([
      c.env.DB.prepare("insert into storage_locations (user_id, name, note) values (?, '主仓', '系统默认仓位')").bind(userId),
      ...SEED_ITEMS.map((s) =>
        c.env.DB.prepare(
          `insert into items
             (user_id, name, category, unit, pack_size, pack_unit, min_stock, weekly_target, default_location_id)
           values (?, ?, ?, ?, ?, ?, ?, ?,
                   (select id from storage_locations where user_id = ? and name = '主仓'))`,
        ).bind(userId, s.name, s.category, s.unit, s.packSize ?? null, s.packUnit ?? null, s.minStock, s.minStock * 2, userId),
      ),
      c.env.DB.prepare('insert into user_settings (user_id, store_name) values (?, ?)').bind(userId, `${displayName}的门店`),
      c.env.DB.prepare(
        `insert into audit_events (user_id, entity_type, entity_id, action, summary)
         values (?, 'account', ?, 'REGISTER', '创建账号')`,
      ).bind(userId, userId),
    ]);

    const token = await startSession(c.env, userId, optionalUserAgent(c.req.header('user-agent')));
    setCookie(c, COOKIE_NAME, token, sessionCookieOptions(c.req.url));
    return c.json({ ok: true, user: { id: userId, username, displayName, currency: 'EUR' }, seeded: SEED_ITEMS.length }, 201);
  });

  app.post('/api/login', async (c) => {
    const { ip, fails } = await throttle(c);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const username = (typeof body.username === 'string' ? body.username.trim() : '').toLowerCase();
    const clientKey = requireClientKey(body.key);

    const user = await c.env.DB.prepare(
      `select u.id, u.username, u.display_name, u.salt, u.pass_hash, u.iterations,
              coalesce(us.currency, 'EUR') as currency
       from users u left join user_settings us on us.user_id = u.id where u.username = ?`,
    )
      .bind(username)
      .first<{
        id: number;
        username: string;
        display_name: string;
        salt: string;
        pass_hash: string;
        iterations: number;
        currency: string;
      }>();

    // 用户名不存在和密码错误返回同一句话，免得被人拿来枚举有哪些账号
    const hash = user ? await derive(clientKey, user.salt, user.iterations) : '';
    if (!user || !timingSafeEqual(hash, user.pass_hash)) {
      const left = await recordFail(c.env, ip, fails);
      throw new ApiError(401, left > 0 ? `用户名或密码不对，还可以试 ${left} 次` : '尝试太多次了，请稍后再试');
    }

    await c.env.DB.batch([
      c.env.DB.prepare('delete from login_guard where ip = ?').bind(ip),
      c.env.DB.prepare("update users set last_login_at = datetime('now'), updated_at = datetime('now') where id = ?").bind(user.id),
      c.env.DB.prepare(
        `insert into audit_events (user_id, entity_type, entity_id, action, summary)
         values (?, 'account', ?, 'LOGIN', '账号登录')`,
      ).bind(user.id, user.id),
    ]);
    const token = await startSession(c.env, user.id, optionalUserAgent(c.req.header('user-agent')));
    setCookie(c, COOKIE_NAME, token, sessionCookieOptions(c.req.url));
    return c.json({
      ok: true,
      user: { id: user.id, username: user.username, displayName: user.display_name, currency: user.currency },
    });
  });

  app.post('/api/logout', async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (token) {
      await c.env.DB.prepare('delete from sessions where token_hash = ?').bind(await sha256Hex(token)).run();
    }
    deleteCookie(c, COOKIE_NAME, { path: '/' });
    return c.json({ ok: true });
  });
}

function optionalUserAgent(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text.slice(0, 255) : null;
}
