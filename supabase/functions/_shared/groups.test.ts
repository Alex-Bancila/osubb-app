import { assertEquals } from "@std/assert";
import {
  buildGroupLookup,
  type GroupReference,
  normalizeGroupKey,
} from "./groups.ts";

Deno.test("normalizing folds case, diacritics and runs of whitespace", () => {
  assertEquals(normalizeGroupKey("Educațional"), "educational");
  // The cedilla spellings every older Windows keyboard produced (ş, ţ) fold to
  // the same key as the correct comma-below ones (ș, ț).
  assertEquals(normalizeGroupKey("Educaţional"), "educational");
  assertEquals(normalizeGroupKey("  IMAGINE   &   PR "), "imagine & pr");
  assertEquals(normalizeGroupKey("Tineret"), "tineret");
  assertEquals(normalizeGroupKey("Întâlniri"), "intalniri");
});

const groups: GroupReference[] = [
  { id: 1, name: "Educațional", short: "EDU", path: [1] },
  { id: 2, name: "Resurse Umane", short: "HR", path: [2] },
  { id: 3, name: "Echipa App", short: "APP", path: [1, 3] },
];

Deno.test("a Group answers to its short name and its display name alike", () => {
  const lookup = buildGroupLookup(groups);

  assertEquals(lookup.resolve("EDU"), [1]);
  assertEquals(lookup.resolve("educational"), [1]);
  assertEquals(lookup.resolve("  hr  "), [2]);
  assertEquals(lookup.resolve("nu există"), []);
});

Deno.test("ancestry answers from the Group's own path", () => {
  const lookup = buildGroupLookup(groups);

  assertEquals(lookup.isBelow(3, 1), true);
  assertEquals(lookup.isBelow(3, 3), true);
  assertEquals(lookup.isBelow(3, 2), false);
  assertEquals(lookup.isBelow(1, 3), false);
});

Deno.test("membership of the active set is what missing-id checks read", () => {
  const lookup = buildGroupLookup(groups);

  assertEquals(lookup.has(1), true);
  assertEquals(lookup.has(99), false);
});

Deno.test("two Groups sharing a spelling are both returned, never guessed between", () => {
  const lookup = buildGroupLookup([
    ...groups,
    { id: 4, name: "Echipa App", short: null, path: [2, 4] },
  ]);

  assertEquals(lookup.resolve("echipa app"), [3, 4]);
});
