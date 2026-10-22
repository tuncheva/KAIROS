import { describe, expect, it } from "vitest";

import { pageContextFromPath, parsePageContext } from "~/lib/pageContext";
import { noteHref, projectHref, projectTasksHref } from "~/lib/routes";

describe("pageContextFromPath", () => {
  it("names the note a note route opens", () => {
    expect(pageContextFromPath(noteHref(12))).toEqual({ kind: "note", id: 12 });
    expect(pageContextFromPath("/notes", "?note=7")).toEqual({ kind: "note", id: 7 });
  });

  it("names a note by the public id its URL actually carries", () => {
    // What a note page looks like in the app: `/notes/<publicId>`. Matching
    // digits only made the AI button blind on every real note.
    expect(pageContextFromPath("/notes/i9Br8R4D3aEi")).toEqual({
      kind: "note",
      publicId: "i9Br8R4D3aEi",
    });
    expect(pageContextFromPath("/notes/a b")).toBeNull();
  });

  it("names the project the projects page has open", () => {
    const [path, query] = projectHref(4).split("?");
    expect(pageContextFromPath(path!, query)).toEqual({ kind: "project", id: 4 });

    const [boardPath, boardQuery] = projectTasksHref(9).split("?");
    expect(pageContextFromPath(boardPath!, boardQuery)).toEqual({ kind: "project", id: 9 });
  });

  it("falls back to the section when nothing in it is open", () => {
    expect(pageContextFromPath("/notes")).toEqual({ kind: "notes" });
    expect(pageContextFromPath("/notes/new")).toBeNull();
    expect(pageContextFromPath("/projects")).toEqual({ kind: "projects" });
    expect(pageContextFromPath("/progress")).toEqual({ kind: "tasks" });
    expect(pageContextFromPath("/calendar/")).toEqual({ kind: "calendar" });
    expect(pageContextFromPath("/dashboard")).toEqual({ kind: "dashboard" });
    expect(pageContextFromPath("/publish")).toEqual({ kind: "events" });
  });

  it("has nothing to say about pages with nothing to point at", () => {
    expect(pageContextFromPath("/settings")).toBeNull();
    expect(pageContextFromPath("/chat/ai")).toBeNull();
    expect(pageContextFromPath("/")).toBeNull();
  });

  it("ignores ids that are not positive integers", () => {
    expect(pageContextFromPath("/projects", "?projectId=abc")).toEqual({ kind: "projects" });
    expect(pageContextFromPath("/projects", "?projectId=0")).toEqual({ kind: "projects" });
  });
});

describe("parsePageContext", () => {
  it("accepts what the client sends", () => {
    expect(parsePageContext({ kind: "note", id: 3 })).toEqual({ kind: "note", id: 3 });
    expect(parsePageContext({ kind: "note", publicId: "i9Br8R4D3aEi" })).toEqual({
      kind: "note",
      publicId: "i9Br8R4D3aEi",
    });
    expect(parsePageContext({ kind: "note", publicId: "'; drop" })).toBeUndefined();
    expect(parsePageContext({ kind: "calendar" })).toEqual({ kind: "calendar" });
  });

  it("drops anything else instead of failing the turn", () => {
    expect(parsePageContext(undefined)).toBeUndefined();
    expect(parsePageContext("note")).toBeUndefined();
    expect(parsePageContext({ kind: "note" })).toBeUndefined();
    expect(parsePageContext({ kind: "note", id: -1 })).toBeUndefined();
    expect(parsePageContext({ kind: "note", id: 1.5 })).toBeUndefined();
    expect(parsePageContext({ kind: "settings" })).toBeUndefined();
  });

  it("keeps only the kind and id", () => {
    expect(
      parsePageContext({ kind: "project", id: 2, title: "Injected title" }),
    ).toEqual({ kind: "project", id: 2 });
  });
});
