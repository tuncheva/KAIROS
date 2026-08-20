import { describe, it, expect } from "vitest";
import { encryptContent, decryptContent } from "~/server/security/encryption";

/**
 * Extended encryption tests — edge cases, security properties, and robustness.
 * encryptContent/decryptContent take (content, password, salt).
 */

const salt = "test-salt-16chars";

describe("Encryption — Edge Cases", () => {
  it("handles empty string content", () => {
    const password = "test-password-123";
    const encrypted = encryptContent("", password, salt);
    const decrypted = decryptContent(encrypted, password, salt);
    expect(decrypted).toBe("");
  });

  it("handles very long content (10KB)", () => {
    const password = "test-password-456";
    const longContent = "x".repeat(10_000);
    const encrypted = encryptContent(longContent, password, salt);
    const decrypted = decryptContent(encrypted, password, salt);
    expect(decrypted).toBe(longContent);
  });

  it("handles unicode content", () => {
    const password = "test-password-789";
    const unicodeContent = "Привет мир 🌍 日本語 العربية";
    const encrypted = encryptContent(unicodeContent, password, salt);
    const decrypted = decryptContent(encrypted, password, salt);
    expect(decrypted).toBe(unicodeContent);
  });

  it("handles special characters in password", () => {
    const password = "p@$$w0rd!#%^&*()[]{}";
    const content = "Secret note";
    const encrypted = encryptContent(content, password, salt);
    const decrypted = decryptContent(encrypted, password, salt);
    expect(decrypted).toBe(content);
  });

  it("handles newlines and tabs in content", () => {
    const password = "test-password";
    const content = "Line 1\nLine 2\tTabbed\r\nWindows line";
    const encrypted = encryptContent(content, password, salt);
    const decrypted = decryptContent(encrypted, password, salt);
    expect(decrypted).toBe(content);
  });
});

describe("Encryption — Security Properties", () => {
  it("encrypted output is a base64 string of significant length", () => {
    const encrypted = encryptContent("test", "password", salt);
    expect(encrypted.length).toBeGreaterThan(20);
  });

  it("different passwords produce different ciphertext", () => {
    const content = "Same content";
    const enc1 = encryptContent(content, "password1", salt);
    const enc2 = encryptContent(content, "password2", salt);
    expect(enc1).not.toBe(enc2);
  });

  it("same content encrypted twice produces different ciphertext (random IV)", () => {
    const content = "Same content";
    const password = "same-password";
    const enc1 = encryptContent(content, password, salt);
    const enc2 = encryptContent(content, password, salt);
    expect(enc1).not.toBe(enc2);
  });

  it("wrong password throws an error", () => {
    const encrypted = encryptContent("secret", "correct-password", salt);
    expect(() => decryptContent(encrypted, "wrong-password", salt)).toThrow();
  });

  it("tampered ciphertext throws an error", () => {
    const encrypted = encryptContent("secret", "password", salt);
    const tampered = encrypted.slice(0, -5) + "XXXXX";
    expect(() => decryptContent(tampered, "password", salt)).toThrow();
  });
});
