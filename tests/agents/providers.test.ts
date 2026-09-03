import { describe, expect, it } from "vitest";

import { resolveLlmConfig } from "~/server/llm/core/providers";

/**
 * The resolver is what makes one `.env` serve two machines, so the cases that
 * matter are the precedence ones: a preset supplying everything, an override
 * beating it, and the pass-through that keeps a machine with no `LLM_PROVIDER`
 * behaving exactly as it did before presets existed.
 */
describe("resolveLlmConfig", () => {
  it("fills base URL, model chain and key from the named preset", () => {
    const config = resolveLlmConfig({
      LLM_PROVIDER: "nvidia",
      LLM_API_KEY_NVIDIA: "nvapi-key",
    });

    expect(config.provider).toBe("nvidia");
    expect(config.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(config.models).toEqual([
      "deepseek-ai/deepseek-v4-flash",
      "deepseek-ai/deepseek-v4-pro",
    ]);
    expect(config.apiKey).toBe("nvapi-key");
  });

  it("prefers the provider's own key over the shared one", () => {
    const config = resolveLlmConfig({
      LLM_PROVIDER: "velocity",
      LLM_API_KEY: "sk-shared",
      LLM_API_KEY_VELOCITY: "sk-velocity",
      LLM_API_KEY_NVIDIA: "nvapi-other-machine",
    });

    expect(config.apiKey).toBe("sk-velocity");
    expect(config.baseUrl).toBe("https://chat.velocity.online/api/v1");
  });

  it("falls back to the shared key when the provider has none", () => {
    const config = resolveLlmConfig({
      LLM_PROVIDER: "nvidia",
      LLM_API_KEY: "sk-shared",
    });

    expect(config.apiKey).toBe("sk-shared");
  });

  it("is case-insensitive about the provider name", () => {
    expect(resolveLlmConfig({ LLM_PROVIDER: "NVIDIA" }).provider).toBe("nvidia");
  });

  it("lets explicit variables override the preset", () => {
    const config = resolveLlmConfig({
      LLM_PROVIDER: "nvidia",
      LLM_BASE_URL: "https://llm.test/api/v1/",
      LLM_MODEL: "some-other-model",
      LLM_API_KEY_NVIDIA: "nvapi-key",
    });

    expect(config.baseUrl).toBe("https://llm.test/api/v1");
    // The preset's fallback goes with it: it was never tested against this model.
    expect(config.models).toEqual(["some-other-model"]);
  });

  it("keeps an explicit fallback alongside an explicit primary", () => {
    const config = resolveLlmConfig({
      LLM_PROVIDER: "nvidia",
      LLM_MODEL: "primary",
      LLM_FALLBACK_MODEL: "secondary",
    });

    expect(config.models).toEqual(["primary", "secondary"]);
  });

  it("passes raw variables straight through with no provider set", () => {
    const config = resolveLlmConfig({
      LLM_BASE_URL: "https://llm.test/api/v1",
      LLM_API_KEY: "sk-test",
      LLM_MODEL: "primary-model",
      LLM_FALLBACK_MODEL: "fallback-model",
      LLM_MODEL_FAST: "fast-model",
    });

    expect(config.provider).toBeNull();
    expect(config.models).toEqual(["primary-model", "fallback-model"]);
    expect(config.fastModel).toBe("fast-model");
  });

  it("treats a blank value as unset rather than as a value", () => {
    // A left-over `LLM_API_KEY_NVIDIA=` line should not shadow the shared key
    // with an empty string, and a blank override should not name a model "".
    const config = resolveLlmConfig({
      LLM_PROVIDER: "nvidia",
      LLM_MODEL: "  ",
      LLM_FALLBACK_MODEL: "",
      LLM_API_KEY_NVIDIA: "  ",
      LLM_API_KEY: "sk-shared",
    });

    expect(config.models).toEqual([
      "deepseek-ai/deepseek-v4-flash",
      "deepseek-ai/deepseek-v4-pro",
    ]);
    expect(config.apiKey).toBe("sk-shared");
  });

  it("resolves to nothing when neither a preset nor the variables are set", () => {
    const config = resolveLlmConfig({});

    expect(config.baseUrl).toBe("");
    expect(config.models).toEqual([]);
  });

  it("throws on an unknown provider rather than silently serving nothing", () => {
    expect(() => resolveLlmConfig({ LLM_PROVIDER: "openai" })).toThrow(
      /not a known provider/,
    );
  });
});
