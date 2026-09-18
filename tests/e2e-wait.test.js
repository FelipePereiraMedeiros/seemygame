import { afterEach, expect, it, vi } from 'vitest';
import { waitForAsync } from '../tools/e2e/wait.mjs';

afterEach(() => vi.useRealTimers());
it('não aceita Promise resolvida como false como estado pronto', async () => {
  vi.useFakeTimers();
  const predicate = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
  let done = false;
  const pending = waitForAsync(predicate, { timeout: 1000, interval: 100 }).then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(100);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  await pending;
  expect(predicate).toHaveBeenCalledTimes(3);
});
it('falha se todas as observações assíncronas forem falsas', async () => {
  vi.useFakeTimers();
  const assertion = expect(waitForAsync(async () => false, { timeout: 200, interval: 100 })).rejects.toThrow('200ms');
  await vi.advanceTimersByTimeAsync(200);
  await assertion;
});
it('preserva erros reais da observação', async () => {
  await expect(waitForAsync(async () => { throw new Error('página fechada'); })).rejects.toThrow('página fechada');
});
