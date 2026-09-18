export async function waitForAsync(predicate, { timeout = 45000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error(`Estado da aplicação não confirmado em ${timeout}ms`);
}
