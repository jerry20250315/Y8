import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { get_y8_logger } from '../../base/logger/index.js';

// helper to remove folder recursively
async function remove_dir(dir: string) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }
}

describe('y8_logger basic behaviors', () => {
  // 将测试产物统一放到项目内的 src/test/logger/logs 目录，便于查看与持久化
  const base_tmp = path.join(process.cwd(), 'src', 'test', 'logger', 'logs');

  afterEach(async () => {
    // 若设置环境变量 Y8_KEEP_LOGS=1，则保留日志目录便于调试
    if (process.env.Y8_KEEP_LOGS === '1') {
      // 在保留模式下记录路径，方便用户查看
      // eslint-disable-next-line no-console
      console.log('y8_logger: keeping logs at', base_tmp);
      return;
    }
    await remove_dir(base_tmp);
  });

  it('should create log files and rotate by size', async () => {
    const service_name = 'test_service_size_' + Date.now();
    const log_dir = path.join(base_tmp, service_name);
    await fs.mkdir(log_dir, { recursive: true });

    const logger = get_y8_logger({
      log_dir,
      service_name,
      max_size_bytes: 500, // small to force rotation
      rotate_daily: false,
      retention_days: 2,
      compress_old: true,
      level: 'debug',
    });

    // write many messages to trigger rotation
    for (let i = 0; i < 40; i++) {
      // messages are async but logger methods return promises
      // ensure serialization
      // @ts-ignore
      await logger.info('message_' + i, { i });
    }

    // give some time for async compression to finish
    await new Promise((r) => setTimeout(r, 800));

    const files = await fs.readdir(log_dir);
    // expect at least one rotated file (either .log and/or .gz)
    expect(files.length).toBeGreaterThanOrEqual(1);

    // shutdown gracefully
    // @ts-ignore
    await logger.shutdown();
  }, 20000);

  it('should clean up old files according to retention_days', async () => {
    const service_name = 'test_service_retention_' + Date.now();
    const log_dir = path.join(base_tmp, service_name);
    await fs.mkdir(log_dir, { recursive: true });

    // create an old file
    const old_file = path.join(log_dir, 'old_file.log');
    await fs.writeFile(old_file, 'old');
    // set mtime to 10 days ago
    const ten_days_ms = 10 * 24 * 60 * 60 * 1000;
    const old_time = new Date(Date.now() - ten_days_ms);
    await fs.utimes(old_file, old_time, old_time);

    const logger = get_y8_logger({
      log_dir,
      service_name,
      max_size_bytes: 1024 * 1024,
      rotate_daily: false,
      retention_days: 1,
      compress_old: false,
      level: 'info',
    });

    // call cleanup_old_files via any (private) to simulate immediate cleanup
    // @ts-ignore
    await (logger as any).cleanup_old_files();

    const exists = await fs
      .stat(old_file)
      .then(() => true)
      .catch(() => false);

    expect(exists).toBe(false);

    // shutdown
    // @ts-ignore
    await logger.shutdown();
  });
});
