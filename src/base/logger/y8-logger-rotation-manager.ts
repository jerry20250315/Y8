import type { y8_logger_file_manager } from './y8-logger-file-manager.js';

/**
 * y8_logger_rotation_manager
 * 负责判断是否需要轮转（基于大小或按天）。单一职责。
 */
export class y8_logger_rotation_manager {
  private file_manager: y8_logger_file_manager;
  private max_size_bytes: number;
  private rotate_daily: boolean;

  constructor(file_manager: y8_logger_file_manager, max_size_bytes: number, rotate_daily: boolean) {
    /**
     * constructor - 初始化轮转管理器
     * @param file_manager y8_logger_file_manager 实例，用于获取当前文件状态
     * @param max_size_bytes 文件大小阈值，若 <=0 则取消基于大小的轮转
     * @param rotate_daily 是否按天进行轮转
     */
    this.file_manager = file_manager;
    this.max_size_bytes = max_size_bytes;
    this.rotate_daily = rotate_daily;
  }

  /**
   * should_rotate_after_write - 在写入 bytes_written 后判断是否需要轮转
   * @param bytes_written 这次写入的字节数（估算）
   * @returns 若需要轮转则返回 true，否则 false
   */
  should_rotate_after_write(bytes_written: number): boolean {
    const current_bytes = this.file_manager.get_current_file_bytes();
    if (this.max_size_bytes > 0 && current_bytes + bytes_written >= this.max_size_bytes) return true;
    if (this.rotate_daily) {
      const current_day = this.file_manager.get_current_day_key();
      const now_day = this.format_day_key(new Date());
      if (current_day && current_day !== now_day) return true;
    }
    return false;
  }

  /**
   * format_day_key - 根据日期生成 yyyyMMdd 的天键
   * @param date 可选日期，默认当前时间
   * @returns 返回 yyyyMMdd 格式的字符串
   */
  private format_day_key(date = new Date()): string {
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  }
}
