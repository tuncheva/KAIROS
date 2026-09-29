/**
 * Reciprocal rank fusion — the merge that lets keyword and vector search run
 * side by side. The regressions these guard against are the ones the old
 * vector-then-fallback code had: a keyword-only match disappearing because the
 * vector arm returned anything at all.
 */

import { describe, expect, it } from "vitest";

import { fuseRankings } from "~/server/llm/core/rankFusion";

const byId = (r: { id: number }) => r.id;

describe("fuseRankings", () => {
  it("keeps a row that only the keyword arm found", () => {
    const keyword = [{ id: 7 }];
    const vector = [{ id: 1 }, { id: 2 }, { id: 3 }];

    expect(fuseRankings([keyword, vector], byId, 3).map(byId)).toContain(7);
  });

  it("ranks a row found by both arms above rows found by one", () => {
    const keyword = [{ id: 1 }, { id: 2 }];
    const vector = [{ id: 3 }, { id: 2 }];

    expect(fuseRankings([keyword, vector], byId, 3).map(byId)[0]).toBe(2);
  });

  it("deduplicates and returns the first list's copy of a shared row", () => {
    const keyword = [{ id: 1, from: "keyword" }];
    const vector = [{ id: 1, from: "vector" }];

    expect(fuseRankings([keyword, vector], byId, 5)).toEqual([{ id: 1, from: "keyword" }]);
  });

  it("breaks rank ties in list order", () => {
    const keyword = [{ id: 1 }];
    const vector = [{ id: 2 }];

    expect(fuseRankings([keyword, vector], byId, 5).map(byId)).toEqual([1, 2]);
  });

  it("returns the other list unchanged when one arm is empty", () => {
    const keyword = [{ id: 4 }, { id: 5 }, { id: 6 }];

    expect(fuseRankings([keyword, []], byId, 2).map(byId)).toEqual([4, 5]);
  });
});
