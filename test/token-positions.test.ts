import { describe, expect, test } from "vitest";
import { TokenPositions as TP } from "../src/index.js";

describe("TokenPositions", () => {
  test("fromList indexes both ways and positions are ascending", () => {
    const tp = TP.fromList(["the", "cat", "the"]);
    expect(tp.positions("the")).toEqual([0, 2]);
    expect(tp.positions("cat")).toEqual([1]);
    expect(tp.positions("dog")).toEqual([]);
    expect(tp.tokenAt(1)).toBe("cat");
    expect(tp.tokenAt(3)).toBeUndefined();
    expect(tp.tokenAt(-1)).toBeUndefined();
    expect(tp.bounds()).toEqual([0, 2]);
  });

  test("remove deletes exactly one occurrence", () => {
    let tp = TP.fromList(["the", "cat", "the"]).remove("the", 0);
    expect(tp.positions("the")).toEqual([2]);
    expect(tp.tokenAt(0)).toBeUndefined();
    expect(tp.bounds()).toEqual([1, 2]);

    tp = tp.remove("the", 2).remove("cat", 1);
    expect(tp.positions("the")).toEqual([]);
    expect(tp.bounds()).toBeNull();
  });

  test("remove leaves the receiver untouched", () => {
    const tp = TP.fromList(["a", "b", "a"]);
    const without = tp.remove("a", 2);
    expect(tp.positions("a")).toEqual([0, 2]);
    expect(tp.bounds()).toEqual([0, 2]);
    expect(without.positions("a")).toEqual([0]);
    expect(without.bounds()).toEqual([0, 1]);
  });

  test("remove is a no-op when there is no such occurrence", () => {
    const tp = TP.fromList(["a", "b"]);
    expect(tp.remove("a", 1)).toBe(tp);
    expect(tp.remove("c", 0)).toBe(tp);
    expect(tp.remove("a", 0).remove("a", 0).positions("b")).toEqual([1]);
  });

  test("bounds skips removed positions in the middle and at the ends", () => {
    const tp = TP.fromList(["a", "b", "c", "d"]);
    expect(tp.remove("b", 1).bounds()).toEqual([0, 3]);
    expect(tp.remove("a", 0).remove("b", 1).bounds()).toEqual([2, 3]);
    expect(tp.remove("d", 3).remove("c", 2).bounds()).toEqual([0, 1]);
    expect(TP.fromList([]).bounds()).toBeNull();
  });

  test("does not alias the token list it was built from", () => {
    const tokens = ["a", "b"];
    const tp = TP.fromList(tokens);
    tokens[0] = "z";
    expect(tp.tokenAt(0)).toBe("a");
  });

  test("gapCost in both directions", () => {
    expect(TP.gapCost(0, 3)).toBe(3);
    expect(TP.gapCost(3, 1)).toBe(4.5);
    expect(TP.gapCost(2, 2)).toBe(0);
    expect(TP.gapCost(0, 4)).toBe(4);
    expect(TP.gapCost(4, 0)).toBe(7.5);
  });

  test("weightedRange radiates outwards with the n=0 quirk", () => {
    expect(TP.weightedRange(-1, 2)).toEqual([[0, 0], [1, 1], [1, -1], [2, 2]]);
    expect(TP.weightedRange(-2, -1)).toEqual([[1, -1], [2, -2]]);
    expect(TP.weightedRange(1, 0)).toEqual([]);
    expect(TP.weightedRange(0, 2)).toEqual([[0, 0], [1, 1], [2, 2]]);
    // offset 0 is emitted even though it is below lo, exactly as upstream
    expect(TP.weightedRange(1, 1)).toEqual([[0, 0], [1, 1]]);
    expect(TP.weightedRange(-3, -1)).toEqual([[1, -1], [2, -2], [3, -3]]);
    expect(TP.weightedRange(2, 1)).toEqual([]);
  });
});
