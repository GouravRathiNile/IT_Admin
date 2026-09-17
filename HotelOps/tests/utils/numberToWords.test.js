const test = require("node:test");
const assert = require("node:assert/strict");
const { numberToWords } = require("../../utils/numberToWords");

test("notification counts convert to English words", () => {
  assert.equal(numberToWords(1), "One");
  assert.equal(numberToWords(4), "Four");
  assert.equal(numberToWords(21), "Twenty-One");
  assert.equal(numberToWords(105), "One Hundred Five");
});
