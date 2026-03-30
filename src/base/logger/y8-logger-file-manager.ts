import fs from "fs";
import path from "path";
import os from "os";

/**
 * y8_logger_file_manager
 * 负责文件名生成、创建写流、以及安全关闭流等底层文件操作。
 * 命名与方法全部使用 snake_case。
 */
export class y8_logger_file_manager {
  private log_dir: string;
  private service_name: string;
  private host_name: string;
  private user_name: string;
  private pid: number;

  // 当前打开的写流与路径，可能为 null
  private current_file_path: string | null = null;
  private current_file_stream: fs.WriteStream | null = null;
  // 当前文件累计写入字节数（估算）
  private current_file_bytes = 0;
  // 当前文件对应的“天”键（yyyyMMdd），用于按天轮转判断
  private current_file_day_key: string | null = null;

  constructor(log_dir: string, service_name: string) {
    /**
     * constructor - 初始化文件管理器
     * @param log_dir 日志目录路径（相对或绝对）
     * @param service_name 服务名，用于生成文件名
     */
    this.log_dir = log_dir;
    this.service_name = service_name;
    this.host_name = os.hostname().replace(/\s+/g, "_");
    this.user_name = (process.env.USER || process.env.USERNAME || "unknown").replace(/\s+/g, "_");
    this.pid = process.pid;
    fs.mkdirSync(this.log_dir, { recursive: true });
  }

  /**
   * format_date_key - 返回精确到毫秒的时间戳片段，用于文件名
   * 形式: yyyyMMddHHmmssSSS
   */
  private format_date_key(date = new Date()): string {
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    return (
      date.getFullYear().toString() +
      pad(date.getMonth() + 1) +
      pad(date.getDate()) +
      pad(date.getHours()) +
      pad(date.getMinutes()) +
      pad(date.getSeconds()) +
      String(date.getMilliseconds()).padStart(3, "0")
    );
  }

  /**
   * format_day_key - 按天的键（yyyyMMdd），用于判断是否跨天
   */
  private format_day_key(date = new Date()): string {
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  }

  /**
   * generate_file_name - 生成文件名：host_user_service_pid_date.log
   * 例如：myhost_jerry_myservice_12345_20260322123456789.log
   */
  private generate_file_name(date = new Date()): string {
    const date_key = this.format_date_key(date);
    // 如果 service_name 末尾包含时间戳（例如测试时使用 service_name + Date.now()），
    // 我们在文件名中去掉该尾部时间戳，只保留更可读的 service_name 部分与统一的格式化日期。
    const sanitized_service = this.service_name.replace(/_\d{10,}$/, "");
    return `${this.host_name}_${this.user_name}_${sanitized_service}_${this.pid}_${date_key}.log`;
  }

  /**
   * create_new_log_file - 创建新的追加写流并重置计数器
   * @returns 返回对象包含 file_path 和正在写入的 file_stream
   */
  async create_new_log_file(): Promise<{ file_path: string; file_stream: fs.WriteStream }> {
    const now = new Date();
    const file_name = this.generate_file_name(now);
    const file_path = path.join(this.log_dir, file_name);
    const file_stream = fs.createWriteStream(file_path, { flags: "a" });
    this.current_file_path = file_path;
    this.current_file_stream = file_stream;
    this.current_file_bytes = 0;
    this.current_file_day_key = this.format_day_key(now);
    return { file_path, file_stream };
  }

  /**
   * close_current_file_and_wait - 结束并等待当前写流 flush 完成
   * @returns 解析为已关闭的旧文件路径，若没有打开文件则返回 null
   */
  async close_current_file_and_wait(): Promise<string | null> {
    if (!this.current_file_stream) return null;
    const stream_to_close = this.current_file_stream;
    const file_path = this.current_file_path;
    // 清空当前引用，防止并发写入使用到已关闭流
    this.current_file_stream = null;
    this.current_file_path = null;
    this.current_file_bytes = 0;
    this.current_file_day_key = null;

    return new Promise((resolve) => {
      // end 会在缓冲区 flush 后调用回调
      stream_to_close.end(() => resolve(file_path));
      // 超时兜底（5s）避免无限等待
      setTimeout(() => resolve(file_path), 5000);
    });
  }

  /* 访问器 */
  get_current_file_stream(): fs.WriteStream | null {
    return this.current_file_stream;
  }

  get_current_file_path(): string | null {
    return this.current_file_path;
  }

  /**
   * increase_bytes - 增加当前文件的已写入字节计数（粗略估算）
   * @param n 估算增加的字节数
   * @returns void
   */
  increase_bytes(n: number) {
    this.current_file_bytes += n;
  }

  get_current_file_bytes(): number {
    return this.current_file_bytes;
  }

  get_current_day_key(): string | null {
    return this.current_file_day_key;
  }

  get_log_dir(): string {
    return this.log_dir;
  }
}
