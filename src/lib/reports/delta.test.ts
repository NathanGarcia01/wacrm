import { describe, expect, it } from "vitest"
import { pointsDelta, relativeDelta } from "./delta"

const labels = { vsPrevious: "vs. prev", new: "Novo", flat: "Sem variação" }

describe("relativeDelta", () => {
  it("computes a positive relative change", () => {
    expect(relativeDelta(150, 100, labels)).toEqual({ sign: 1, arrowSign: 1, label: "+50% vs. prev" })
  })

  it("computes a negative relative change", () => {
    expect(relativeDelta(50, 100, labels)).toEqual({ sign: -1, arrowSign: -1, label: "-50% vs. prev" })
  })

  it("reports 'new' when the previous period was zero and current isn't", () => {
    expect(relativeDelta(10, 0, labels)).toEqual({ sign: 1, arrowSign: 1, label: "Novo" })
  })

  it("reports 'flat' when both periods are zero", () => {
    expect(relativeDelta(0, 0, labels)).toEqual({ sign: 0, arrowSign: 0, label: "Sem variação" })
  })

  it("returns undefined when either value is null", () => {
    expect(relativeDelta(null, 100, labels)).toBeUndefined()
    expect(relativeDelta(100, null, labels)).toBeUndefined()
  })

  it("treats no change as sign 0", () => {
    expect(relativeDelta(100, 100, labels)).toEqual({ sign: 0, arrowSign: 0, label: "0% vs. prev" })
  })

  it("flips the color sign (not the arrow or the label) for higherIsBetter=false — response time dropping is good news shown with a DOWN arrow in green", () => {
    expect(relativeDelta(90, 100, labels, false)).toEqual({ sign: 1, arrowSign: -1, label: "-10% vs. prev" })
  })

  it("flips the color sign for higherIsBetter=false when the value rose (bad), arrow still points up", () => {
    expect(relativeDelta(110, 100, labels, false)).toEqual({ sign: -1, arrowSign: 1, label: "+10% vs. prev" })
  })

  it("flips the 'new' color sign too, but not the 'new' label text", () => {
    expect(relativeDelta(10, 0, labels, false)).toEqual({ sign: -1, arrowSign: 1, label: "Novo" })
  })
})

describe("pointsDelta", () => {
  it("computes a positive point difference", () => {
    expect(pointsDelta(25, 20, labels)).toEqual({ sign: 1, arrowSign: 1, label: "+5 p.p. vs. prev" })
  })

  it("computes a negative point difference", () => {
    expect(pointsDelta(20, 25, labels)).toEqual({ sign: -1, arrowSign: -1, label: "-5 p.p. vs. prev" })
  })

  it("does not divide by the previous value when it's zero (unlike relativeDelta)", () => {
    expect(pointsDelta(5, 0, labels)).toEqual({ sign: 1, arrowSign: 1, label: "+5 p.p. vs. prev" })
  })

  it("returns undefined when either value is null", () => {
    expect(pointsDelta(null, 20, labels)).toBeUndefined()
    expect(pointsDelta(20, null, labels)).toBeUndefined()
  })

  it("flips the color sign (not the arrow) for higherIsBetter=false", () => {
    expect(pointsDelta(15, 20, labels, false)).toEqual({ sign: 1, arrowSign: -1, label: "-5 p.p. vs. prev" })
  })
})
