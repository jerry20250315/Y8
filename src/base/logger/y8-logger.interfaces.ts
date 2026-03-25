import type { Level } from 'pino';

/**
 * y8_logger_config - 配置项（所有字段使用 snake_case）
 * @property log_dir 日志输出目录，外部传入
 * @property max_size_bytes 单个日志文件最大字节数，默认 20MB
 * @property rotate_daily 是否按天轮转（会在日期变更时切换），默认 true
 * @property retention_days 按天保留历史文件，默认 7 天
 * @property compress_old 是否压缩旧日志为 .gz，默认 true
 * @property level pino 日志级别，默认 info
 * @property service_name 服务名， 用于文件名与单例 key
 */
export interface y8_logger_config {
  log_dir: string;
  max_size_bytes?: number;
  rotate_daily?: boolean;
  retention_days?: number;
  compress_old?: boolean;
  level?: Level | string;
  service_name: string;
}
