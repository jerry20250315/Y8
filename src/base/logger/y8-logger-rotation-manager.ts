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
    this.file_manager = file_manager;
    this.max_size_bytes = max_size_bytes;
    this.rotate_daily = rotate_daily;
  }

  /**
   * should_rotate_after_write - 在写入 bytes_written 后判断是否需要轮转
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

  private format_day_key(date = new Date()): string {
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  }
}
