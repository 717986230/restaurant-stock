/**
 * 密码派生放在手机上做，服务器从头到尾拿不到明文密码。
 *
 * 之所以这么设计：免费版 Workers 每个请求只有 10ms CPU，跑不动几十万次迭代的
 * PBKDF2；而手机这点算力绰绰有余（一次约 0.2~0.5 秒，一次登录管 90 天）。
 * 服务端再拿这里的结果加一层 2 万次带随机盐的 PBKDF2，
 * 所以攻击者即使拖走整个数据库，每猜一次密码仍要付 62 万次迭代的代价。
 */
const CLIENT_ITERATIONS = 600_000;

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 客户端盐必须是登录前就能算出来的，所以由用户名推导而不是随机生成。
 * 它不需要保密，作用只是让同样的密码在不同账号下派生出不同结果，
 * 挡住通用彩虹表。
 */
function clientSalt(username: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(`restaurant-stock:${username.toLowerCase()}`));
}

export async function deriveKey(username: string, password: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: await clientSalt(username), iterations: CLIENT_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return toHex(bits);
}
