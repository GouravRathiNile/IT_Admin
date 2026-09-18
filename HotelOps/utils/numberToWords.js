const SMALL_NUMBERS = Object.freeze([
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
  "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
  "Sixteen", "Seventeen", "Eighteen", "Nineteen",
]);
const TENS = Object.freeze(["", "", "Twenty", "Thirty", "Forty", "Fifty",
  "Sixty", "Seventy", "Eighty", "Ninety"]);

const belowThousand = (value) => {
  const words = [];
  let number = value;
  if (number >= 100) {
    words.push(`${SMALL_NUMBERS[Math.floor(number / 100)]} Hundred`);
    number %= 100;
  }
  if (number >= 20) {
    words.push(TENS[Math.floor(number / 10)] + (number % 10
      ? `-${SMALL_NUMBERS[number % 10]}` : ""));
  } else if (number > 0 || words.length === 0) {
    words.push(SMALL_NUMBERS[number]);
  }
  return words.join(" ");
};

// Notification summaries use readable words while stored/API counts stay numeric.
const numberToWords = (value) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) return String(value);
  if (number < 1000) return belowThousand(number);
  const scales = [[1_000_000_000_000_000, "Quadrillion"],
    [1_000_000_000_000, "Trillion"], [1_000_000_000, "Billion"],
    [1_000_000, "Million"], [1_000, "Thousand"]];
  const scale = scales.find(([size]) => number >= size);
  const [size, name] = scale;
  const remainder = number % size;
  return `${numberToWords(Math.floor(number / size))} ${name}${remainder
    ? ` ${numberToWords(remainder)}` : ""}`;
};

module.exports = { numberToWords };
