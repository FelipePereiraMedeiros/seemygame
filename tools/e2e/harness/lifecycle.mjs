export async function bounded(name, action, timeoutMs = 15000) {
  let timer;
  try {
    return await Promise.race([action(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${name}: timeout ${timeoutMs}ms`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export function createCleanupCollector(report) {
  return async (name, action) => {
    try { await bounded(name, action); }
    catch (error) { (report.cleanupErrors ||= []).push(error.message); report.status = 'failed'; process.exitCode = 1; }
  };
}
