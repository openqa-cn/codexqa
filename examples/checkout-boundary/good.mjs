export function checkout(amount) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be positive');
  return { accepted: true, amount };
}
