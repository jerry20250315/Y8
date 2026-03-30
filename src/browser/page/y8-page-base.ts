import type { Page } from 'playwright';

/**
 * y8_page_base
 * - Page 对象基类，用于封装页面常用操作，便于业务页面对象继承
 * - 所有方法使用 snake_case 命名，内部复用 y8_page_controller 提供的稳健动作
 */
export class y8_page_base {
  protected page: Page;

  /**
   * constructor - 创建页面基类
   * @param page Playwright Page 实例
   */
  constructor(page: Page) {
    this.page = page;
  }

  /**
   * goto - 导航到指定 URL
   */
  async goto(url: string, options?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }) {
    const timeout = options?.timeout ?? 30000;
    await this.page.goto(url, { timeout, waitUntil: options?.waitUntil as any });
  }

  /**
   * click - 点击元素
   */
  async click(selector: string, options?: { timeout?: number; retries?: number; button?: 'left' | 'right' | 'middle' }) {
    const timeout = options?.timeout ?? 5000;
    await this.page.click(selector, { timeout, button: options?.button ?? 'left' });
  }

  /**
   * input - 填充输入框或内容可编辑区域
   */
  async input(selector: string, text: string, options?: { clear?: boolean; timeout?: number; typingDelay?: number }) {
    const timeout = options?.timeout ?? 5000;
    await this.page.fill(selector, text, { timeout } as any);
  }

  /**
   * wait_for_selector - 等待 selector 出现
   */
  async wait_for_selector(selector: string, timeout?: number) {
    if (typeof timeout === 'number') {
      await this.page.waitForSelector(selector, { timeout });
    } else {
      await this.page.waitForSelector(selector);
    }
  }

  /**
   * get_text - 获取元素文本（优先 textContent）
   */
  async get_text(selector: string): Promise<string | null> {
    const txt = await this.page.textContent(selector);
    return txt;
  }

  /**
   * is_visible - 检查元素是否可见
   */
  async is_visible(selector: string): Promise<boolean> {
    try {
      return await this.page.isVisible(selector);
    } catch (e) {
      // 老版本或某些环境可能没有 isVisible，fallback to evaluate
      try {
        return await this.page.evaluate((sel: string) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) return false;
          const style = window.getComputedStyle(el);
          return style && style.visibility !== 'hidden' && style.display !== 'none' && el.offsetParent !== null;
        }, selector);
      } catch (e2) {
        return false;
      }
    }
  }

  /**
   * screenshot - 页面截图
   */
  async screenshot(options?: { path?: string; fullPage?: boolean; quality?: number }) {
    return await this.page.screenshot(options as any);
  }
}

export default y8_page_base;
