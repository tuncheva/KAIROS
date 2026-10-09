import { describe, expect, it } from "vitest";

import en from "~/i18n/messages/en.json";
import bg from "~/i18n/messages/bg.json";
import de from "~/i18n/messages/de.json";
import es from "~/i18n/messages/es.json";
import fr from "~/i18n/messages/fr.json";
import {
  AGENT_SETTINGS,
  AGENT_SETTING_IDS,
  agentSetting,
  defaultAgentSettings,
  inProjectScope,
  parseAgentSettingValue,
  resolveAgentSettings,
  type AgentSettingDef,
} from "~/lib/agentSettings";

const def = (id: (typeof AGENT_SETTING_IDS)[number]) => AGENT_SETTINGS[id] as AgentSettingDef;

describe("agent settings catalog", () => {
  it("keys every entry by `<agent>.<key>`", () => {
    for (const id of AGENT_SETTING_IDS) expect(id).toBe(`${def(id).agent}.${def(id).key}`);
  });

  it("has defaults its own validator accepts", () => {
    for (const id of AGENT_SETTING_IDS) {
      expect(parseAgentSettingValue(id, def(id).default)).toEqual({ ok: true, value: def(id).default });
    }
  });

  it("offers only options its validator accepts", () => {
    for (const id of AGENT_SETTING_IDS) {
      const control = def(id).control;
      if (control.kind === "choice") {
        for (const option of control.options) expect(parseAgentSettingValue(id, option).ok).toBe(true);
      }
      if (control.kind === "multi") {
        expect(parseAgentSettingValue(id, [...control.options]).ok).toBe(true);
      }
    }
  });

  it("has a label for every option in every locale", () => {
    for (const [locale, messages] of Object.entries({ en, bg, de, es, fr })) {
      const values = (messages as { settings: { ai: { crew: { values: Record<string, Record<string, Record<string, string>>> } } } })
        .settings.ai.crew.values;
      for (const id of AGENT_SETTING_IDS) {
        const { agent, key, control } = def(id);
        if (control.kind === "toggle" || control.kind === "text" || control.kind === "projects") continue;
        for (const option of control.options) {
          expect(values[agent]?.[key]?.[String(option)], `${locale}: ${id}.${String(option)}`).toBeTruthy();
        }
      }
    }
  });
});

describe("resolving agent settings", () => {
  it("is all defaults when nothing is stored", () => {
    expect(resolveAgentSettings({ workspace: {}, personal: null })).toEqual(defaultAgentSettings());
  });

  it("reads personal settings from the user's blob only", () => {
    const resolved = resolveAgentSettings({
      workspace: { "risk_radar.stalledAfterDays": 30 },
      personal: { "risk_radar.stalledAfterDays": 7 },
    });
    expect(resolved["risk_radar.stalledAfterDays"]).toBe(7);
  });

  it("falls back to the default for a stored value that is no longer valid", () => {
    const resolved = resolveAgentSettings({
      workspace: {},
      personal: { "meeting_prep.leadMinutes": 45, "workspace_concierge.tone": "sarcastic" },
    });
    expect(resolved["meeting_prep.leadMinutes"]).toBe(90);
    expect(resolved["workspace_concierge.tone"]).toBe("balanced");
  });

  it("stores a multi-choice in catalog order, without duplicates", () => {
    expect(parseAgentSettingValue("daily_brief.sections", ["risks", "dueToday", "risks"])).toEqual({
      ok: true,
      value: ["dueToday", "risks"],
    });
    expect(parseAgentSettingValue("daily_brief.sections", ["gossip"]).ok).toBe(false);
  });

  it("gives the default to a pack that carries no settings", () => {
    expect(agentSetting(undefined, "risk_radar.stalledAfterDays")).toBe(14);
  });
});

describe("project scope", () => {
  it("is every project by default", () => {
    expect(defaultAgentSettings()["task_planner.scope"]).toEqual({ mode: "all" });
    expect(inProjectScope({ mode: "all" }, 42)).toBe(true);
  });

  it("stores chosen projects sorted and without duplicates", () => {
    expect(
      parseAgentSettingValue("task_planner.scope", { mode: "only", projectIds: [9, 3, 9] }),
    ).toEqual({ ok: true, value: { mode: "only", projectIds: [3, 9] } });
  });

  it("refuses an empty choice and malformed ids", () => {
    expect(parseAgentSettingValue("task_planner.scope", { mode: "only", projectIds: [] }).ok).toBe(false);
    expect(parseAgentSettingValue("task_planner.scope", { mode: "only", projectIds: [-1] }).ok).toBe(false);
    expect(parseAgentSettingValue("task_planner.scope", { mode: "some" }).ok).toBe(false);
  });

  it("keeps only the chosen projects in scope", () => {
    const scope = { mode: "only" as const, projectIds: [3, 9] };
    expect(inProjectScope(scope, 3)).toBe(true);
    expect(inProjectScope(scope, 4)).toBe(false);
  });
});

