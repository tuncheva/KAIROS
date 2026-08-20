import { describe, it, expect } from "vitest";
import {
  EventCreateSchema,
  EventUpdateSchema,
  EventDeleteSchema,
  EventCommentAddSchema,
  EventCommentDeleteSchema,
  EventRsvpSchema,
  EventLikeToggleSchema,
  EventsPublisherDraftSchema,
  EventsPublisherDraftInputSchema,
  EventsPublisherConfirmInputSchema,
  EventsPublisherApplyInputSchema,
  EventsPublisherDraftOutputSchema,
  EventsPublisherConfirmOutputSchema,
  EventsPublisherApplyOutputSchema,
} from "~/server/llm/schemas/a4EventsPublisherSchemas";

/* ─────────── EventCreateSchema ─────────── */

describe("EventCreateSchema", () => {
  const validCreate = {
    title: "Summer BBQ",
    description: "A great party",
    eventDate: "2025-08-01T18:00:00Z",
    region: "sofia",
    enableRsvp: true,
    sendReminders: false,
    clientRequestId: "req-001",
  };

  it("accepts a valid create payload", () => {
    const result = EventCreateSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
  });

  it("accepts optional imageUrl", () => {
    const result = EventCreateSchema.safeParse({
      ...validCreate,
      imageUrl: "https://example.com/img.jpg",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = EventCreateSchema.safeParse({ ...validCreate, title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects title longer than 256 chars", () => {
    const result = EventCreateSchema.safeParse({
      ...validCreate,
      title: "a".repeat(257),
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid region", () => {
    const result = EventCreateSchema.safeParse({
      ...validCreate,
      region: "fake_city",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid regions", () => {
    const regions = [
      "sofia", "plovdiv", "varna", "burgas", "ruse",
      "stara_zagora", "pleven", "sliven", "dobrich", "shumen",
    ];
    for (const region of regions) {
      const result = EventCreateSchema.safeParse({ ...validCreate, region });
      expect(result.success).toBe(true);
    }
  });

  it("rejects missing clientRequestId", () => {
    const result = EventCreateSchema.safeParse({
      title: validCreate.title,
      description: validCreate.description,
      eventDate: validCreate.eventDate,
      region: validCreate.region,
      enableRsvp: validCreate.enableRsvp,
      sendReminders: validCreate.sendReminders,
    });
    expect(result.success).toBe(false);
  });

  it("rejects extra unknown fields (strict mode)", () => {
    const result = EventCreateSchema.safeParse({
      ...validCreate,
      extraField: "should fail",
    });
    expect(result.success).toBe(false);
  });

  it("defaults enableRsvp to false when omitted", () => {
    const result = EventCreateSchema.safeParse({
      title: validCreate.title,
      description: validCreate.description,
      eventDate: validCreate.eventDate,
      region: validCreate.region,
      sendReminders: validCreate.sendReminders,
      clientRequestId: validCreate.clientRequestId,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enableRsvp).toBe(false);
    }
  });
});

/* ─────────── EventUpdateSchema ─────────── */

describe("EventUpdateSchema", () => {
  it("accepts a valid update with patch", () => {
    const result = EventUpdateSchema.safeParse({
      eventId: 1,
      patch: { title: "Updated Title" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-positive eventId", () => {
    const result = EventUpdateSchema.safeParse({
      eventId: 0,
      patch: { title: "X" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative eventId", () => {
    const result = EventUpdateSchema.safeParse({
      eventId: -5,
      patch: { title: "X" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional reason", () => {
    const result = EventUpdateSchema.safeParse({
      eventId: 1,
      patch: { description: "New desc" },
      reason: "Fixing typo",
    });
    expect(result.success).toBe(true);
  });

  it("rejects extra patch fields (strict mode)", () => {
    const result = EventUpdateSchema.safeParse({
      eventId: 1,
      patch: { title: "X", unknownField: true },
    });
    expect(result.success).toBe(false);
  });

  it("accepts patch with region enum value", () => {
    const result = EventUpdateSchema.safeParse({
      eventId: 1,
      patch: { region: "varna" },
    });
    expect(result.success).toBe(true);
  });
});

/* ─────────── EventDeleteSchema ─────────── */

describe("EventDeleteSchema", () => {
  it("accepts a valid delete", () => {
    const result = EventDeleteSchema.safeParse({
      eventId: 42,
      reason: "Outdated event",
      dangerous: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing dangerous flag", () => {
    const result = EventDeleteSchema.safeParse({
      eventId: 42,
      reason: "Outdated",
    });
    expect(result.success).toBe(false);
  });

  it("rejects dangerous: false", () => {
    const result = EventDeleteSchema.safeParse({
      eventId: 42,
      reason: "Outdated",
      dangerous: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty reason", () => {
    const result = EventDeleteSchema.safeParse({
      eventId: 42,
      reason: "",
      dangerous: true,
    });
    expect(result.success).toBe(false);
  });
});

/* ─────────── EventCommentAddSchema ─────────── */

describe("EventCommentAddSchema", () => {
  it("accepts a valid comment", () => {
    const result = EventCommentAddSchema.safeParse({
      eventId: 1,
      text: "Great event!",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty text", () => {
    const result = EventCommentAddSchema.safeParse({
      eventId: 1,
      text: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects text longer than 500 chars", () => {
    const result = EventCommentAddSchema.safeParse({
      eventId: 1,
      text: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

/* ─────────── EventCommentDeleteSchema ─────────── */

describe("EventCommentDeleteSchema", () => {
  it("accepts a valid comment delete", () => {
    const result = EventCommentDeleteSchema.safeParse({
      eventId: 1,
      commentId: 5,
      reason: "Spam",
      dangerous: true,
    });
    expect(result.success).toBe(true);
  });

  it("requires dangerous: true", () => {
    const result = EventCommentDeleteSchema.safeParse({
      eventId: 1,
      commentId: 5,
      reason: "Spam",
    });
    expect(result.success).toBe(false);
  });
});

/* ─────────── EventRsvpSchema ─────────── */

describe("EventRsvpSchema", () => {
  it("accepts valid RSVP statuses", () => {
    for (const status of ["going", "maybe", "not_going"]) {
      const result = EventRsvpSchema.safeParse({ eventId: 1, status });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid RSVP status", () => {
    const result = EventRsvpSchema.safeParse({
      eventId: 1,
      status: "interested",
    });
    expect(result.success).toBe(false);
  });
});

/* ─────────── EventLikeToggleSchema ─────────── */

describe("EventLikeToggleSchema", () => {
  it("accepts a valid like toggle", () => {
    const result = EventLikeToggleSchema.safeParse({ eventId: 1 });
    expect(result.success).toBe(true);
  });

  it("rejects float eventId", () => {
    const result = EventLikeToggleSchema.safeParse({ eventId: 1.5 });
    expect(result.success).toBe(false);
  });
});

/* ─────────── EventsPublisherDraftSchema ─────────── */

describe("EventsPublisherDraftSchema", () => {
  const minimalDraft = {
    agentId: "events_publisher" as const,
    summary: "Created one event",
  };

  it("accepts a minimal draft with defaults", () => {
    const result = EventsPublisherDraftSchema.safeParse(minimalDraft);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.creates).toEqual([]);
      expect(result.data.updates).toEqual([]);
      expect(result.data.deletes).toEqual([]);
      expect(result.data.risks).toEqual([]);
      expect(result.data.questionsForUser).toEqual([]);
    }
  });

  it("rejects wrong agentId", () => {
    const result = EventsPublisherDraftSchema.safeParse({
      ...minimalDraft,
      agentId: "wrong_agent",
    });
    expect(result.success).toBe(false);
  });

  it("enforces max 10 creates", () => {
    const creates = Array.from({ length: 11 }, (_, i) => ({
      title: `Event ${i}`,
      description: "Desc",
      eventDate: "2025-08-01T18:00:00Z",
      region: "sofia",
      clientRequestId: `req-${i}`,
    }));
    const result = EventsPublisherDraftSchema.safeParse({
      ...minimalDraft,
      creates,
    });
    expect(result.success).toBe(false);
  });

  it("enforces max 20 updates", () => {
    const updates = Array.from({ length: 21 }, (_, i) => ({
      eventId: i + 1,
      patch: { title: "X" },
    }));
    const result = EventsPublisherDraftSchema.safeParse({
      ...minimalDraft,
      updates,
    });
    expect(result.success).toBe(false);
  });

  it("enforces max 5 deletes", () => {
    const deletes = Array.from({ length: 6 }, (_, i) => ({
      eventId: i + 1,
      reason: "Cleanup",
      dangerous: true as const,
    }));
    const result = EventsPublisherDraftSchema.safeParse({
      ...minimalDraft,
      deletes,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a full draft with all fields", () => {
    const fullDraft = {
      agentId: "events_publisher" as const,
      creates: [
        {
          title: "BBQ Party",
          description: "Grill time",
          eventDate: "2025-08-01T18:00:00Z",
          region: "plovdiv",
          enableRsvp: true,
          sendReminders: true,
          clientRequestId: "cr-1",
        },
      ],
      updates: [{ eventId: 1, patch: { title: "Updated" } }],
      deletes: [{ eventId: 2, reason: "Cancelled", dangerous: true as const }],
      comments: {
        add: [{ eventId: 1, text: "Nice!" }],
        remove: [{ eventId: 1, commentId: 3, reason: "Spam", dangerous: true as const }],
      },
      rsvps: [{ eventId: 1, status: "going" as const }],
      likes: [{ eventId: 1 }],
      summary: "Full plan",
      risks: ["Risk 1"],
      questionsForUser: ["Are you sure?"],
      diffPreview: {
        creates: ["BBQ Party in Plovdiv"],
        updates: ["Updated event #1 title"],
        deletes: ["Deleted event #2"],
        comments: ["+1 comment on event #1"],
        rsvps: ["RSVP going to event #1"],
      },
      planHash: "abc12345",
    };
    const result = EventsPublisherDraftSchema.safeParse(fullDraft);
    expect(result.success).toBe(true);
  });

  it("rejects empty summary", () => {
    const result = EventsPublisherDraftSchema.safeParse({
      ...minimalDraft,
      summary: "",
    });
    expect(result.success).toBe(false);
  });
});

/* ─────────── tRPC API schemas ─────────── */

describe("EventsPublisherDraftInputSchema", () => {
  it("accepts a valid draft input", () => {
    const result = EventsPublisherDraftInputSchema.safeParse({
      message: "Create a BBQ event in Sofia",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty message", () => {
    const result = EventsPublisherDraftInputSchema.safeParse({ message: "" });
    expect(result.success).toBe(false);
  });

  it("accepts optional handoffContext", () => {
    const result = EventsPublisherDraftInputSchema.safeParse({
      message: "Hello",
      handoffContext: { fromAgent: "workspace_concierge" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects extra fields (strict mode)", () => {
    const result = EventsPublisherDraftInputSchema.safeParse({
      message: "Hello",
      extra: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("EventsPublisherConfirmInputSchema", () => {
  it("accepts a valid confirm input", () => {
    const result = EventsPublisherConfirmInputSchema.safeParse({
      draftId: "draft-123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty draftId", () => {
    const result = EventsPublisherConfirmInputSchema.safeParse({ draftId: "" });
    expect(result.success).toBe(false);
  });
});

describe("EventsPublisherApplyInputSchema", () => {
  it("accepts a valid apply input", () => {
    const result = EventsPublisherApplyInputSchema.safeParse({
      draftId: "draft-123",
      confirmationToken: "token-abc",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing confirmationToken", () => {
    const result = EventsPublisherApplyInputSchema.safeParse({
      draftId: "draft-123",
    });
    expect(result.success).toBe(false);
  });
});

/* ─────────── Output schemas ─────────── */

describe("EventsPublisherDraftOutputSchema", () => {
  it("accepts valid output", () => {
    const result = EventsPublisherDraftOutputSchema.safeParse({
      draftId: "d-1",
      plan: {
        agentId: "events_publisher",
        summary: "Created event",
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("EventsPublisherConfirmOutputSchema", () => {
  it("accepts valid output", () => {
    const result = EventsPublisherConfirmOutputSchema.safeParse({
      confirmationToken: "tok-123",
      summary: {
        creates: 1,
        updates: 0,
        deletes: 0,
        commentsAdded: 0,
        commentsRemoved: 0,
        rsvps: 0,
        likes: 0,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative counts", () => {
    const result = EventsPublisherConfirmOutputSchema.safeParse({
      confirmationToken: "tok-123",
      summary: {
        creates: -1,
        updates: 0,
        deletes: 0,
        commentsAdded: 0,
        commentsRemoved: 0,
        rsvps: 0,
        likes: 0,
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("EventsPublisherApplyOutputSchema", () => {
  it("accepts valid output", () => {
    const result = EventsPublisherApplyOutputSchema.safeParse({
      applied: true,
      results: {
        createdEventIds: [1],
        updatedEventIds: [],
        deletedEventIds: [],
        commentsAdded: 0,
        commentsRemoved: 0,
        rsvpsSet: 0,
        likesToggled: 0,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects applied: false", () => {
    const result = EventsPublisherApplyOutputSchema.safeParse({
      applied: false,
      results: {
        createdEventIds: [],
        updatedEventIds: [],
        deletedEventIds: [],
        commentsAdded: 0,
        commentsRemoved: 0,
        rsvpsSet: 0,
        likesToggled: 0,
      },
    });
    expect(result.success).toBe(false);
  });
});
