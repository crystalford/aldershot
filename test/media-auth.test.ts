/**
 * Who may read a media object.
 *
 * This decides whether one customer can fetch another customer's footage, so
 * the prefix logic is attacked rather than demonstrated. Every case here is a
 * way the check could be talked into saying yes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ownerOf, ownsByPrefix } from "../src/media-auth.ts";

const ME = "01M19ZPBSFHSTNJ5G84THHTYTT";
const THEM = "01M1ARCYYT6BC8NYRH6AA4X2M8";
const MINE = `u/${ME}/sources/01M1A0FBGQT3WMZDSZY61S3ZMT/original.mp4`;

test("reads the owner out of a real key", () => {
  assert.equal(ownerOf(MINE), ME);
  assert.equal(ownerOf(`u/${ME}/beats/01ABC.webm`), ME);
});

test("lets someone read their own object", () => {
  assert.equal(ownsByPrefix(ME, MINE), true);
});

test("refuses another account's object", () => {
  assert.equal(ownsByPrefix(THEM, MINE), false);
});

test("refuses traversal out of the owner's prefix", () => {
  for (const key of [
    `u/${ME}/../${THEM}/sources/x/original.mp4`,
    `u/${ME}/sources/../../${THEM}/sources/x/original.mp4`,
    `u/${ME}/..`,
    `u/${ME}/sources/..%2f../x`,
  ]) {
    assert.equal(ownsByPrefix(ME, key), false, `allowed traversal: ${key}`);
    assert.equal(ownerOf(key), null, `owner extracted from traversal: ${key}`);
  }
});

test("refuses backslashes and absolute paths", () => {
  assert.equal(ownerOf(`\\u\\${ME}\\x`), null);
  assert.equal(ownerOf(`/u/${ME}/x`), null);
});

test("refuses a key that is not the shape we write", () => {
  for (const key of ["", "x", "u", "u/", `u/${ME}`, "sources/x/original.mp4", "//x"]) {
    assert.equal(ownerOf(key), null, `accepted malformed key: ${JSON.stringify(key)}`);
    assert.equal(ownsByPrefix(ME, key), false);
  }
});

test("a user id that merely starts the same is not a match", () => {
  /* The trailing separator is what stops "u/AB/..." being readable by user
     "A". ULIDs are fixed length so this cannot arise today, and it is one
     schema change away from arising tomorrow. */
  assert.equal(ownsByPrefix("01M19Z", `u/${ME}/sources/x/original.mp4`), false);
  assert.equal(ownsByPrefix(ME, `u/${ME}EXTRA/sources/x/original.mp4`), false);
});

test("an empty or bogus user id matches nothing", () => {
  assert.equal(ownsByPrefix("", MINE), false);
  assert.equal(ownsByPrefix("undefined", MINE), false);
});
