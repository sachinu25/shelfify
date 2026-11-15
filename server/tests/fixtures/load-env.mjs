// Loads the env module with the parent's environment and reports the outcome.
try {
  const { env } = await import('../../src/config/env.js');
  console.log(JSON.stringify({ booted: true, isProd: env.isProd, secretLength: env.JWT_ACCESS_SECRET.length, warnings: env.warnings }));
} catch (err) {
  console.log(JSON.stringify({ booted: false, error: err.message }));
}
