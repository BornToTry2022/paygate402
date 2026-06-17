import { describe, it, expect } from "vitest";
import { validatePolicyPatch } from "./validate";

describe("validatePolicyPatch", () => {
  it("defaults merchantId to press and accepts an empty patch", () => {
    const r = validatePolicyPatch({});
    expect(r.ok && r.patch.merchantId).toBe("press");
  });
  it("accepts a valid partial patch and whitelists only known fields", () => {
    const r = validatePolicyPatch({ merchantId: "press", enabled: true, dailyCapUsd: 0.5, evil: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch).toEqual({ merchantId: "press", enabled: true, dailyCapUsd: 0.5 });
      expect("evil" in r.patch).toBe(false);
    }
  });
  it("rejects a prototype-pollution merchantId", () => {
    expect(validatePolicyPatch({ merchantId: "__proto__" }).ok).toBe(false);
  });
  it("rejects merchantId with illegal chars or wrong length", () => {
    expect(validatePolicyPatch({ merchantId: "a/b" }).ok).toBe(false);
    expect(validatePolicyPatch({ merchantId: "" }).ok).toBe(false);
  });
  it("rejects non-finite / negative numeric caps", () => {
    expect(validatePolicyPatch({ dailyCapUsd: Infinity }).ok).toBe(false);
    expect(validatePolicyPatch({ dailyCapUsd: -1 }).ok).toBe(false);
    expect(validatePolicyPatch({ humanApprovalThresholdUsd: "1" }).ok).toBe(false);
  });
  it("lowercases and validates allowlist addresses, rejecting non-addresses", () => {
    const r = validatePolicyPatch({ allowlist: ["0xABc0000000000000000000000000000000000001"] });
    expect(r.ok && r.patch.allowlist).toEqual(["0xabc0000000000000000000000000000000000001"]);
    expect(validatePolicyPatch({ allowlist: ["nope"] }).ok).toBe(false);
  });
  it("requires positive-integer velocity fields", () => {
    expect(validatePolicyPatch({ velocity: { maxCount: 0, windowMs: 1000 } }).ok).toBe(false);
    expect(validatePolicyPatch({ velocity: { maxCount: 2.5, windowMs: 1000 } }).ok).toBe(false);
    expect(validatePolicyPatch({ velocity: { maxCount: 5, windowMs: 1000 } }).ok).toBe(true);
  });
  it("rejects a non-object body", () => {
    expect(validatePolicyPatch(null).ok).toBe(false);
    expect(validatePolicyPatch([]).ok).toBe(false);
  });
});
