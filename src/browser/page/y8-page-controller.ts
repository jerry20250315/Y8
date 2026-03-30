import type { Page } from 'playwright';
import { y8_page_base } from './y8-page-base.js';

/**
 * y8_page_controller
 * - 更强壮的页面动作实现，继承自 y8_page_base，覆盖并扩展基础行为
 */
export class y8_page_controller extends y8_page_base {
  protected default_timeout = 5000;

  constructor(page: Page, opts?: { default_timeout?: number }) {
    super(page);
    if (opts?.default_timeout) this.default_timeout = opts.default_timeout;
  }

  private async ensure_visible(selector: string, timeout = this.default_timeout): Promise<boolean> {
    try {
      const handle = await this.page.waitForSelector(selector, { timeout });
      if (!handle) return false;
      await handle.evaluate((el: Element) => {
        (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  async click(selector: string, options?: { timeout?: number; retries?: number; button?: 'left' | 'right' | 'middle' }) {
    const timeout = options?.timeout ?? this.default_timeout;
    const retries = options?.retries ?? 2;
    let lastErr: any = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await this.ensure_visible(selector, timeout);
        await this.page.click(selector, { timeout, button: options?.button ?? 'left' });
        return;
      } catch (err) {
        lastErr = err;
        try {
          const ok = await this.page.evaluate(async (sel: string) => {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (!el) return false;
            el.scrollIntoView({ block: 'center', inline: 'center' });
            try {
              el.click();
              return true;
            } catch (e) {
              const ev = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
              el.dispatchEvent(ev);
              return true;
            }
          }, selector);
          if (ok) return;
        } catch (e) {
          lastErr = e;
        }
        await this.page.waitForTimeout(100);
      }
    }
    throw lastErr;
  }

  async input(selector: string, text: string, options?: { clear?: boolean; timeout?: number; typingDelay?: number }) {
    const timeout = options?.timeout ?? this.default_timeout;
    try {
      await this.ensure_visible(selector, timeout);
      await this.page.fill(selector, text, { timeout } as any);
      return;
    } catch (e) {
      try {
        await this.page.focus(selector, { timeout });
        if (options?.clear) {
          await this.page.keyboard.press('Control+A');
          await this.page.keyboard.press('Backspace');
        }
        const delay = options?.typingDelay ?? 50;
        await this.page.keyboard.type(text, { delay });
        return;
      } catch (e2) {
        const ok = await this.page.evaluate((data: { sel: string; val: string }) => {
          const el = document.querySelector(data.sel) as any;
          if (!el) return false;
          try {
            if ('value' in el) el.value = data.val;
            else el.textContent = data.val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          } catch (e) {
            return false;
          }
        }, { sel: selector, val: text });
        if (ok) return;
        throw e2;
      }
    }
  }

  async scroll_to(target: { selector?: string; x?: number; y?: number }, options?: { behavior?: 'auto' | 'smooth' }) {
    if (target.selector) {
      await this.page.evaluate((data: { sel: string; behavior: string }) => {
        const el = document.querySelector(data.sel);
        if (el && (el as HTMLElement).scrollIntoView) {
          (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center', behavior: data.behavior as any });
        }
      }, { sel: target.selector, behavior: options?.behavior ?? 'auto' });
      return;
    }
    const x = target.x ?? 0;
    const y = target.y ?? 0;
    await this.page.evaluate((data: { x: number; y: number; behavior: string }) => window.scrollTo({ left: data.x, top: data.y, behavior: data.behavior as any }), { x, y, behavior: options?.behavior ?? 'auto' });
  }

  async wait(opts: { selector?: string; timeout?: number; loadState?: 'load' | 'domcontentloaded' | 'networkidle' } = {}) {
    const timeout = opts.timeout ?? this.default_timeout;
    if (opts.selector) {
      if (typeof timeout === 'number') await this.page.waitForSelector(opts.selector, { timeout });
      else await this.page.waitForSelector(opts.selector);
      return;
    }
    if (opts.loadState) {
      await this.page.waitForLoadState(opts.loadState, { timeout });
      return;
    }
    await this.page.waitForTimeout(timeout);
  }

  async goto(url: string, options?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }) {
    const timeout = options?.timeout ?? 30000;
    try {
      await this.page.goto(url, { timeout, waitUntil: options?.waitUntil ?? 'load' as any });
      return;
    } catch (e) {
      try {
        await this.page.evaluate((u: string) => { window.location.href = u; }, url);
        await this.page.waitForLoadState(options?.waitUntil ?? 'load', { timeout });
        return;
      } catch (e2) {
        const clicked = await this.page.evaluate(async (u: string) => {
          const anchors = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
          const a = anchors.find(x => x.href === u || x.getAttribute('href') === u);
          if (!a) return false;
          a.click();
          return true;
        }, url);
        if (clicked) {
          await this.page.waitForLoadState(options?.waitUntil ?? 'load', { timeout });
          return;
        }
        throw e;
      }
    }
  }
}

export default y8_page_controller;
