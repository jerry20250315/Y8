import { EventEmitter } from 'events';
import path from 'path';
import type { Browser, BrowserContext, Page, LaunchOptions } from 'playwright';
import { chromium, firefox, webkit } from 'playwright';
import type { y8_browser_launch_options, y8_browser_context_options } from './y8-browser.interfaces.js';

/**
 * y8-browser-base
 * - 提供统一的浏览器启动/关闭以及 context/page 管理基础封装
 * - 以便后续业务层继承扩展（例如页面对象、测试步骤封装等）
 */
export class y8_browser_base {
  private options: y8_browser_launch_options;
  private browser: Browser | null = null;
  private default_context: BrowserContext | null = null;
  private emitter = new EventEmitter();

  /**
   * constructor - 创建 browser_base
  * @param options 启动选项，详见 y8_browser_launch_options
   */
  constructor(options?: y8_browser_launch_options) {
    this.options = {
      browser_type: 'chromium',
      headless: true,
      create_default_context: true,
      ...options,
    } as y8_browser_launch_options;
  }

  /**
   * launch - 启动浏览器进程
   * @returns Promise<Browser> 在浏览器启动完成后解析并返回 Browser 实例
   */
  async launch(): Promise<Browser> {
    if (this.browser) return this.browser;

    const bt = this.options.browser_type || 'chromium';
    let browser_inst: Browser;
    // Prepare user-provided Playwright options but strip properties that are undefined
    const user_opts: Partial<LaunchOptions> = { ...(this.options as Partial<LaunchOptions>) };
    if (user_opts.env === undefined) {
      // remove the property entirely so the object literal doesn't contain `env: undefined`
      delete (user_opts as any).env;
    }

    const launch_opts: Partial<LaunchOptions> = {
      headless: this.options.headless ?? true,
      ...(typeof (this.options as any).args !== 'undefined' ? { args: (this.options as any).args } : {}),
      ...(typeof (this.options as any).slowMo !== 'undefined' ? { slowMo: (this.options as any).slowMo } : {}),
      // merge remaining user options (env will only be present if defined)
      ...user_opts,
    };

    if (bt === 'firefox') browser_inst = await firefox.launch(launch_opts as any);
    else if (bt === 'webkit') browser_inst = await webkit.launch(launch_opts as any);
    else browser_inst = await chromium.launch(launch_opts as any);

    this.browser = browser_inst;

    if (this.options.create_default_context) {
      this.default_context = await this.browser.newContext();
    }

    this.emitter.emit('launched', { browser_type: bt });
    return this.browser;
  }

  /**
   * new_context - 创建一个新的 BrowserContext（或返回默认 context）
   * @param ctx_opts 可选的 context 配置
   * @returns Promise<BrowserContext> 新创建或缓存的 context
   */
  async new_context(ctx_opts?: y8_browser_context_options): Promise<BrowserContext> {
    if (!this.browser) await this.launch();
    if (this.options.create_default_context && !ctx_opts && this.default_context) return this.default_context as BrowserContext;
    return (this.browser as Browser).newContext(ctx_opts as any);
  }

  /**
   * new_page - 在指定 context 或默认 context 中创建 Page
   * @param ctx 可选上下文，若未提供则使用默认 context（若不存在则会创建）
   * @returns Promise<Page> 创建完成的 Page
   */
  async new_page(ctx?: BrowserContext): Promise<Page> {
    const context = ctx ?? (await this.new_context());
    return context.newPage();
  }

  /**
   * close - 关闭浏览器及其所有上下文
   * @returns Promise<void> 在浏览器完全退出后解析
   */
  async close(): Promise<void> {
    if (!this.browser) return;
    try {
      await this.browser.close();
    } finally {
      this.browser = null;
      this.default_context = null;
      this.emitter.emit('closed');
    }
  }

  /**
   * is_launched - 检查浏览器是否已启动
   * @returns boolean
   */
  is_launched(): boolean {
    return !!this.browser;
  }

  /**
   * on - 订阅事件（'launched'|'closed'）
   * @param ev 事件名
   * @param cb 回调函数
   */
  on(ev: 'launched' | 'closed', cb: (...args: any[]) => void) {
    this.emitter.on(ev, cb);
  }

  /**
   * get_browser - 返回当前 Browser 实例或 null
   * @returns Browser | null
   */
  get_browser(): Browser | null {
    return this.browser;
  }
}

export default y8_browser_base;
