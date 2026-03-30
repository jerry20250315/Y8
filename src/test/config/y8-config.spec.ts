import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

import { y8_config_manager } from '../../base/config/index.js';

const BASE = path.join(process.cwd(), 'src', 'test', 'config');

async function cleanupDir(dir: string) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe('y8_config_manager', () => {
  let tmp_dir: string;

  beforeEach(async () => {
    tmp_dir = path.join(BASE, 'tmp-' + Date.now() + '-' + Math.floor(Math.random() * 10000));
    await fs.mkdir(tmp_dir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupDir(tmp_dir);
  });

  it('should save and load YAML data', async () => {
    const fp = path.join(tmp_dir, 'app.yml');
    const mgr = new y8_config_manager(fp);

    const before = await mgr.load();
    expect(before).toBeNull();

    const data = { hello: 'world', n: 123 };
    await mgr.save(data);

    const after = await mgr.load();
    expect(after).toEqual(data);
  });

  it('should emit change on file update (watch)', async () => {
    const fp = path.join(tmp_dir, 'app.yml');
    // use small debounce to make test faster
    const mgr = new y8_config_manager(fp, { debounce_ms: 50 });

    // initial save
    await mgr.save({ a: 1 });

    const ev: Array<any> = [];
    const p = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('watch timeout')), 2000);
      mgr.watch((new_data, old_data) => {
        ev.push({ new_data, old_data });
        clearTimeout(timeout);
        resolve();
      });
    });

    // update file via save
    await mgr.save({ a: 2, b: 'x' });

    await p; // wait for watcher to fire

    expect(ev.length).toBeGreaterThanOrEqual(1);
    const first = ev[0];
    expect(first.old_data).toEqual({ a: 1 });
    expect(first.new_data).toEqual({ a: 2, b: 'x' });

    mgr.stop_watching();
  });
});
