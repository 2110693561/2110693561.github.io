import { randomBytes, pbkdf2Sync, createCipheriv } from "node:crypto";

/**
 * 构建时加密内容，供浏览器端解锁。
 * 仅在 Node 环境（astro build / astro dev 的服务端）运行。
 *
 * 加密方案：PBKDF2 派生密钥（与浏览器 WebCrypto 参数一致）+ AES-256-GCM
 * WebCrypto 的 AES-GCM 要求密文尾部附带 16 字节 auth tag，所以这里把 tag 拼在密文后。
 */

const PBKDF2_ITERATIONS = 120000;

export interface EncryptedPayload {
  /** base64 salt */
  salt: string;
  /** base64 iv */
  iv: string;
  /** base64 (ciphertext + auth tag) */
  data: string;
}

export function encryptForBrowser(plain: string, password: string): EncryptedPayload {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    data: Buffer.concat([encrypted, tag]).toString("base64"),
  };
}

export const PBKDF2_ITERATIONS_EXPORT = PBKDF2_ITERATIONS;
