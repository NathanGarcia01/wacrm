import { describe, expect, it } from "vitest";
import { getPlanFeatures } from "./features";

describe("getPlanFeatures", () => {
  it("starter: 1 channel, 500 broadcasts/month, nothing premium", () => {
    expect(getPlanFeatures("starter")).toEqual({
      maxChannels: 1,
      maxBroadcastsPerMonth: 500,
      hasAI: false,
      hasDailyReport: false,
      hasWebhookOut: false,
      hasAPI: false,
    });
  });

  it("pro: 3 channels, unlimited broadcasts, still no AI/report/webhook/API", () => {
    const pro = getPlanFeatures("pro");
    expect(pro.maxChannels).toBe(3);
    expect(pro.maxBroadcastsPerMonth).toBe(Infinity);
    expect(pro.hasAI).toBe(false);
    expect(pro.hasDailyReport).toBe(false);
    expect(pro.hasWebhookOut).toBe(false);
    expect(pro.hasAPI).toBe(false);
  });

  it("business: everything unlimited/unlocked", () => {
    const business = getPlanFeatures("business");
    expect(business.maxChannels).toBe(Infinity);
    expect(business.maxBroadcastsPerMonth).toBe(Infinity);
    expect(business.hasAI).toBe(true);
    expect(business.hasDailyReport).toBe(true);
    expect(business.hasWebhookOut).toBe(true);
    expect(business.hasAPI).toBe(true);
  });

  it("falls back to starter's limits for null, undefined, or an unrecognized plan code", () => {
    expect(getPlanFeatures(null)).toEqual(getPlanFeatures("starter"));
    expect(getPlanFeatures(undefined)).toEqual(getPlanFeatures("starter"));
    expect(getPlanFeatures("enterprise")).toEqual(getPlanFeatures("starter"));
    expect(getPlanFeatures("")).toEqual(getPlanFeatures("starter"));
  });
});
