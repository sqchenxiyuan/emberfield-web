/** Expected additive ledger schema only; historical source bytes stay untouched. */
export function withMedicineLedgers(stats) {
  const result = structuredClone(stats);
  for (const name of ['produced', 'consumed', 'spoiled', 'destroyed'])
    result[name] = { ...result[name], herb: 0 };
  return result;
}
