import type { EventEmitter } from 'events';

/**
 * y8_config_data - parsed YAML config (object, array or null)
 */
export type y8_config_data = Record<string, any> | any[] | null;

/**
 * y8_config_change_callback - invoked when file content changes
 * @param new_data 新的数据（可能为 null）
 * @param old_data 旧的数据（可能为 null）
 */
export type y8_config_change_callback = (new_data: y8_config_data, old_data: y8_config_data) => void;

/**
 * y8_config_manager_options - 传入构造器的可选项
 */
export interface y8_config_manager_options {
  /** debounce 延迟，毫秒，默认 150 */
  debounce_ms?: number;
  /** 保存时如果文件不存在是否创建，默认 true */
  create_if_missing?: boolean;
}
