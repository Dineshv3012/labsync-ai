import 'dotenv/config';
import { loadConfig } from './server/config';
import { createApp } from './server/app';

async function main() {
  const config = loadConfig();
  const { server, ctx } = await createApp(config);
  server.listen(config.port, () => {
    console.log(`LabSync AI running at ${config.baseUrl} (${config.nodeEnv})`);
    console.log(`  database : ${config.databasePath}`);
    console.log(`  uploads  : ${config.uploadDir}`);
    console.log(`  Gemini   : ${ctx.ai.provider.configured ? `configured (${ctx.ai.provider.model})` : 'NOT configured - AI endpoints return a clear "not configured" error'}`);
    console.log(`  e-mail   : ${ctx.mailer.configured ? 'SMTP configured' : 'SMTP not configured - verification/reset links are printed here'}`);
  });
  const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start LabSync AI:', err.message || err);
  process.exit(1);
});
