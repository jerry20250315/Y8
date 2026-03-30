import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import YAML from 'js-yaml';
import type { y8_config_data, y8_config_change_callback, y8_config_manager_options } from './y8-config.interfaces.js';

/**
 * y8_config_manager
 * - 读取/写入 YAML 配置
 * - 支持对单个文件的变更监听并通过回调通知
 */
export class y8_config_manager {
  private file_path: string;
  private cached: y8_config_data = null;
  private emitter = new EventEmitter();
  private watcher: fs.FSWatcher | null = null;
  private using_watch_file = false;
  private debounce_ms: number;
  private debounce_timer: NodeJS.Timeout | null = null;
  private create_if_missing: boolean;

  /**
   * constructor - 创建一个 y8_config_manager 实例
   * @param file_path 要管理的 YAML 配置文件路径（相对或绝对）
   * @param options 可选配置：debounce_ms（事件去抖延迟，ms），create_if_missing（保存时若不存在是否创建）
   */
  constructor(file_path: string, options?: y8_config_manager_options) {
    this.file_path = path.resolve(file_path);
    this.debounce_ms = options?.debounce_ms ?? 150;
    this.create_if_missing = options?.create_if_missing ?? true;
  }

  /**
   * load - 从磁盘读取并解析 YAML 配置文件并更新缓存
   * @returns 解析后的配置对象（object/array）或 null（文件不存在或内容为空）
   * @throws 读取或解析过程中发生的 IO/解析异常（除 ENOENT 外会向上抛出）
   */
  async load(): Promise<y8_config_data> {
    try {
      const raw = await fsPromises.readFile(this.file_path, { encoding: 'utf8' });
      const parsed = YAML.load(raw) as y8_config_data;
      const old = this.cached;
      this.cached = parsed ?? null;
      return this.cached;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        this.cached = null;
        return null;
      }
      throw err;
    }
  }

  /**
   * get - 返回当前缓存的配置数据
   * @returns 当前缓存的配置（object/array）或 null（尚未加载或文件不存在）
   */
  get(): y8_config_data {
    return this.cached;
  }

  /**
   * save - 将数据序列化为 YAML 并原子性写入磁盘
   * @param data 要写入的配置数据（object/array 或 null）
   * @returns Promise<void> 在写入完成后解析
   * @throws 写入过程中的 IO 异常
   */
  async save(data: y8_config_data): Promise<void> {
    const dir = path.dirname(this.file_path);
    await fsPromises.mkdir(dir, { recursive: true });
    const yamlText = YAML.dump(data ?? {});
    const tmp = `${this.file_path}.tmp`;
    const old = this.cached;
    await fsPromises.writeFile(tmp, yamlText, { encoding: 'utf8' });
    await fsPromises.rename(tmp, this.file_path);
    this.cached = data ?? null;
    // if watchers are present, emit change immediately for internal saves
    try {
      const oldJson = safeStringify(old);
      const newJson = safeStringify(this.cached);
      if (oldJson !== newJson) {
        this.emitter.emit('change', this.cached, old);
      }
    } catch {
      // ignore emit errors
    }
  }

  /**
   * watch - 开始监听文件变化并在内容变化时调用回调
   * @param cb 当文件内容发生逻辑变化时被调用，签名为 (new_data, old_data)
   */
  watch(cb: y8_config_change_callback): void {
    this.emitter.on('change', cb);
    if (this.watcher) return; // already watching

    // 初始化缓存（异步）
    this.load().catch(() => { /* ignore */ });
    // On Windows fs.watch can be unreliable or throw EPERM in some environments.
    // Prefer polling there to avoid flaky tests and permission errors.
    if (process.platform === 'win32') {
      this.setup_polling_watch();
      return;
    }

    try {
      this.watcher = fs.watch(this.file_path, () => {
        this.schedule_debounced_reload();
      });
      // if watcher later emits an error (eg. EPERM on Windows), fallback to polling
      this.watcher.on('error', (werr: any) => {
        try { this.watcher?.close(); } catch { }
        this.watcher = null;
        this.setup_polling_watch();
      });
    } catch (err: any) {
      // If file doesn't exist yet, watch its parent directory. On some platforms
      // and environments (Windows/permission issues) fs.watch may throw EPERM
      // or other errors — in that case fall back to a polling-based watcher.
      if (err.code === 'ENOENT') {
        const dir = path.dirname(this.file_path);
        try {
          this.watcher = fs.watch(dir, (eventType, filename) => {
            if (!filename) return;
            if (filename === path.basename(this.file_path)) {
              this.schedule_debounced_reload();
            }
          });
          this.watcher.on('error', () => {
            try { this.watcher?.close(); } catch { }
            this.watcher = null;
            this.setup_polling_watch();
          });
        } catch (dirErr) {
          // fallback to polling
          this.setup_polling_watch();
        }
      } else {
        // fallback to polling for other errors (EPERM etc.)
        this.setup_polling_watch();
      }
    }
  }

  /**
   * setup_polling_watch - 在无法使用 fs.watch 时回退到 fs.watchFile（轮询）
   */
  private setup_polling_watch() {
    try {
      // use a small interval; tests use small debounce so keep polling responsive
      fs.watchFile(this.file_path, { interval: Math.max(100, this.debounce_ms) }, () => {
        this.schedule_debounced_reload();
      });
      this.using_watch_file = true;
    } catch {
      // as a last resort, set up a timer-based poll
      this.using_watch_file = true;
      setInterval(() => this.schedule_debounced_reload(), Math.max(250, this.debounce_ms * 2));
    }
  }

  /**
   * schedule_debounced_reload - 内部：对文件变化事件进行去抖（防抖）并触发重载
   */
  private schedule_debounced_reload() {
    if (this.debounce_timer) {
      clearTimeout(this.debounce_timer);
    }
    this.debounce_timer = setTimeout(async () => {
      this.debounce_timer = null;
      await this.reload_and_emit_if_changed();
    }, this.debounce_ms);
  }

  /**
   * reload_and_emit_if_changed - 从磁盘重载配置并在发生变化时通过 emitter 发出事件
   * - 读取文件并解析为 newData
   * - 与 cached 进行深度等价比较（通过 JSON.stringify）
   * - 若不同则更新缓存并 emit change(newData, oldData)
   */
  private async reload_and_emit_if_changed() {
    let oldData: y8_config_data = this.cached;
    let newData: y8_config_data = null;
    try {
      const raw = await fsPromises.readFile(this.file_path, { encoding: 'utf8' });
      newData = YAML.load(raw) as y8_config_data;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        newData = null;
      } else {
        return; // parse error or other IO error, ignore
      }
    }

    const oldJson = safeStringify(oldData);
    const newJson = safeStringify(newData);
    if (oldJson !== newJson) {
      this.cached = newData;
      this.emitter.emit('change', newData, oldData);
    }
  }

  /**
   * stop_watching - 停止对文件的监听并移除回调
   * @param cb 可选，若提供则只移除该回调；否则移除全部回调并关闭 watcher
   */
  stop_watching(cb?: y8_config_change_callback) {
    if (cb) this.emitter.off('change', cb);
    else this.emitter.removeAllListeners('change');
    if (this.watcher) {
      try { this.watcher.close(); } catch { }
      this.watcher = null;
    }
    if (this.using_watch_file) {
      try { fs.unwatchFile(this.file_path); } catch { }
      this.using_watch_file = false;
    }
    if (this.debounce_timer) {
      clearTimeout(this.debounce_timer);
      this.debounce_timer = null;
    }
  }
}

function safeStringify(obj: any) {
  try {
    return JSON.stringify(obj ?? null);
  } catch {
    return String(obj);
  }
}

export default y8_config_manager;
