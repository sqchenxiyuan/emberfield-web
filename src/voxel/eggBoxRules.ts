/** Source capacity/threshold; work uses the Web construction clock. Wood-only
 * building material and queued early-empty requests are current Web choices. */
export const EGG_BOX_RULES = Object.freeze({ cost: { wood: 20 }, work: 667,
  capacity: 25, emptyAt: 20, emptyWork: 40, maxHitPoints: 50, maxBoxes: 128, pathCost: 10 });
