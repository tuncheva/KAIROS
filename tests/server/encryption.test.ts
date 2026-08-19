import { describe, it, expect } from "vitest";
import { encryptContent, decryptContent } from "~/server/encryption";

describe("Encryption — AES-256-GCM", () => {
  const password = "strong-password-123";
  const salt = "random-16-char-salt";
  const plaintext = "This is my secret note content 📝";

  /* ── Round-trip ── */
  it("encrypts and decrypts back to the original plaintext", () => {
    const cipher = encryptContent(plaintext, password, salt);
    const result = decryptContent(cipher, password, salt);
    expect(result).toBe(plaintext);
  });

  it("returns a base64-encoded string", () => {
    const cipher = encryptContent(plaintext, password, salt);
    // Base64 regex
    expect(cipher).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("produces ciphertext different from plaintext", () => {
    const cipher = encryptContent(plaintext, password, salt);
    expect(cipher).not.toBe(plaintext);
  });

  /* ── Wrong password ── */
  it("throws when decrypting with the wrong password", () => {
    const cipher = encryptContent(plaintext, password, salt);
    expect(() => decryptContent(cipher, "wrong-password", salt)).toThrow();
  });

  /* ── Wrong salt ── */
  it("throws when decrypting with the wrong salt", () => {
    const cipher = encryptContent(plaintext, password, salt);
    expect(() => decryptContent(cipher, password, "different-salt")).toThrow();
  });

  /* ── Different salts produce different ciphertext ── */
  it("produces different ciphertext for different salts", () => {
    const cipher1 = encryptContent(plaintext, password, "salt-aaa");
    const cipher2 = encryptContent(plaintext, password, "salt-bbb");
    expect(cipher1).not.toBe(cipher2);
  });

  /* ── Different passwords produce different ciphertext ── */
  it("produces different ciphertext for different passwords", () => {
    const cipher1 = encryptContent(plaintext, "pass-one", salt);
    const cipher2 = encryptContent(plaintext, "pass-two", salt);
    expect(cipher1).not.toBe(cipher2);
  });

  /* ── Same input produces different ciphertext (random IV) ── */
  it("produces unique ciphertext on each call (random IV)", () => {
    const cipher1 = encryptContent(plaintext, password, salt);
    const cipher2 = encryptContent(plaintext, password, salt);
    expect(cipher1).not.toBe(cipher2);
    // But both decrypt to the same plaintext
    expect(decryptContent(cipher1, password, salt)).toBe(plaintext);
    expect(decryptContent(cipher2, password, salt)).toBe(plaintext);
  });

  /* ── Empty string ── */
  it("handles empty plaintext", () => {
    const cipher = encryptContent("", password, salt);
    expect(decryptContent(cipher, password, salt)).toBe("");
  });

  /* ── Long content ── */
  it("handles long content (10 KB)", () => {
    const longText = "A".repeat(10_000);
    const cipher = encryptContent(longText, password, salt);
    expect(decryptContent(cipher, password, salt)).toBe(longText);
  });

  /* ── Unicode content ── */
  it("handles Cyrillic / multi-byte unicode", () => {
    const text = "Бележка за среща — 你好世界 🌍";
    const cipher = encryptContent(text, password, salt);
    expect(decryptContent(cipher, password, salt)).toBe(text);
  });

  /* ── Tampered ciphertext ── */
  it("throws on tampered ciphertext (integrity check)", () => {
    const cipher = encryptContent(plaintext, password, salt);
    // Flip a character in the middle
    const buf = Buffer.from(cipher, "base64");
    // `noUncheckedIndexedAccess` types buf[i] as number | undefined, so the
    // in-place `^=` doesn't typecheck. Read, flip, write back explicitly.
    const idx = buf.length - 5;
    expect(idx).toBeGreaterThanOrEqual(0);
    buf[idx] = (buf[idx] ?? 0) ^ 0xff;
    const tampered = buf.toString("base64");
    expect(() => decryptContent(tampered, password, salt)).toThrow();
  });
});
