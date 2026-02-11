import { runDaemon } from './lifecycle';

export async function runDaemonMain(configPath?: string): Promise<void> {
  try {
    await runDaemon({ configPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
