/**
 * y8-browser.interfaces.ts
 * - 与仓库命名约定一致的接口文件
 */

/**
 * y8_browser_launch_options - 用于配置浏览器启动的选项（snake_case, 带 y8 前缀）
 */
export interface y8_browser_launch_options {
  /**
   * 浏览器类型: 'chromium' | 'firefox' | 'webkit'
   * 默认 'chromium'
   */
  browser_type?: 'chromium' | 'firefox' | 'webkit';

  /**
   * 是否在启动后创建一个默认的 browserContext
   * 若为 true，则 launch() 后会自动创建并缓存 context，可通过 new_context() 覆盖
   */
  create_default_context?: boolean;

  /**
   * 是否以 headless 模式启动，默认 true
   */
  headless?: boolean;

  /**
   * 额外的环境变量（可选），会在启动浏览器的子进程中生效
   */
  env?: Record<string, string | undefined>;

  /**
   * 其他 Playwright 启动参数，按需传递
   */
  [key: string]: any;
}

export type y8_browser_context_options = Record<string, any>;
