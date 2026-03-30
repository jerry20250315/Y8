import fs from "fs";
import fs_promises from "fs/promises";
import path from "path";
import stream from "stream";
import pino from "pino";
import pretty from "pino-pretty";


import type { y8_logger_config } from './y8-logger.interfaces.js';
import { y8_logger_file_manager } from './y8-logger-file-manager.js';
import { y8_logger_rotation_manager } from './y8-logger-rotation-manager.js';

/**
 * y8_logger
 * - 按 service_name 做单例（工厂 get_y8_logger）
 * - 同时写入控制台（可读）与文件（JSON）
 * - 支持按大小与按天同时轮转、旧文件压缩与按天清理
 */
class y8_logger {
	// instances map by service_name
	private static instances: Map<string, y8_logger> = new Map();

	private config: y8_logger_config;
	private file_manager: y8_logger_file_manager;
	private rotation_manager: y8_logger_rotation_manager;

	// pino logger 用于文件输出（JSON），通过自定义 write 将日志写入 file stream
	private file_logger: pino.Logger | null = null;
	private console_logger: pino.Logger | null = null;

	// init promise ensures file logger is ready before writing
	private init_promise: Promise<void> | null = null;

	// 定时器用于保留策略的定期清理
	private retention_timer: NodeJS.Timeout | null = null;

	private constructor(config: y8_logger_config) {
		// 合并默认配置
		this.config = {
			max_size_bytes: 20 * 1024 * 1024, // 20MB
			rotate_daily: true,
			retention_days: 7,
			compress_old: true,
			level: "info",
			...config,
		};

		this.file_manager = new y8_logger_file_manager(this.config.log_dir, this.config.service_name);
		this.rotation_manager = new y8_logger_rotation_manager(
			this.file_manager,
			this.config.max_size_bytes!,
			this.config.rotate_daily!
		);

		// 初始化可读的控制台 pretty 打印
		try {
			const pretty_stream = pretty({ colorize: true, translateTime: "yyyy-mm-dd HH:MM:ss.l" });
			// 将 pretty transform 输出到 stdout
			(pretty_stream as stream.Transform).pipe(process.stdout);
			// console_logger 会把 JSON 字符串写入 pretty_stream，进而可读地输出到 stdout
			this.console_logger = pino({ level: this.config.level ?? 'info' }, { write: (msg: string) => (pretty_stream as any).write(msg) } as any);
		} catch (e) {
			// 如果 pino-pretty 不可用或失败，回退到简单 stdout
			this.console_logger = pino({ level: this.config.level ?? 'info' }, pino.destination({ dest: 1, sync: false }));
		}

		// 初始化文件 logger（异步）并保存 promise，以便写入前等待完成
		this.init_promise = this.init_file_logger();

		// schedule retention cleanup
		this.schedule_retention_cleanup();
	}

	/**
	 * get_y8_logger - 工厂方法，按 service_name 返回单例
	 * @param config logger 配置，必须包含 service_name 与 log_dir
	 * @returns 对应 service_name 的单例 y8_logger 实例
	 */
	static get_y8_logger(config: y8_logger_config): y8_logger {
		const key = config.service_name;
		if (!this.instances.has(key)) {
			this.instances.set(key, new y8_logger(config));
		}
		return this.instances.get(key)!;
	}

	/**
	 * init_file_logger - 创建文件写流并包装为 pino logger
	 * 注意：该方法会被轮转逻辑调用以创建新文件
	 * @returns Promise<void> 在初始化完成后解析
	 */
	private async init_file_logger(): Promise<void> {
		const { file_path, file_stream } = await this.file_manager.create_new_log_file();
		// 将真实的 writable stream 直接传递给 pino，避免自定义 write 导致潜在的序列化/回调问题
		// 这允许 pino 直接写入底层流，且我们在轮转时通过 stream.end() 等待其 flush。
		this.file_logger = pino({ level: this.config.level ?? 'info' }, file_stream as any);
		// init 完成后清理 promise 标记
		this.init_promise = null;
	}

	/**
	 * rotate_file_if_needed - 根据写入字节数判断是否需要轮转，并进行轮转操作（平滑关闭旧流）
	 * @param bytes_written 本次写入的大致字节数（用于判断是否超过阈值）
	 * @returns Promise<void> 轮转完成后解析（若不需要轮转立即返回）
	 */
	private async rotate_file_if_needed(bytes_written: number): Promise<void> {
		if (!this.rotation_manager.should_rotate_after_write(bytes_written)) return;
		const old_stream = this.file_manager.get_current_file_stream();
		if (!old_stream) return;
		// 先关闭旧流并等待 flush，确保不丢日志
		const old_file_path = await this.file_manager.close_current_file_and_wait();
		// 创建新文件与 logger
		await this.init_file_logger();
		// 异步处理压缩，不阻塞主写流程
		if (old_file_path && this.config.compress_old) {
			void this.compress_file(old_file_path).catch((e) => {
				// 保持容错，不影响主流程
				console.error("y8_logger compress_file error:", e);
			});
		}
	}

	/**
	 * compress_file - 将给定文件压缩为 .zip 并删除原文件
	 * @param file_path 要压缩的原始日志文件完整路径
	 * @returns Promise<void> 在压缩并删除原文件后解析（若跳过或失败则解析）
	 */
	private async compress_file(file_path: string): Promise<void> {
		const zip_path = file_path + ".zip";
		// 等待文件在磁盘上稳定（存在并且大小大于 0），以避免 race 导致 0kb 的压缩文件
		const max_attempts = 10;
		const attempt_delay_ms = 100;
		let ok = false;
		for (let attempt = 0; attempt < max_attempts; attempt++) {
			try {
				const st = await fs_promises.stat(file_path);
				if (st.size > 0) {
					ok = true;
					break;
				}
			} catch (e) {
				// 文件可能不存在 yet
			}
			// 等待后重试
			await new Promise((r) => setTimeout(r, attempt_delay_ms));
		}
		if (!ok) {
			// 如果文件一直是 0 或不存在，跳过压缩并记录警告
			console.warn(`y8_logger: skip compressing '${file_path}' because file is missing or zero-sized`);
			// 尝试删除空文件以避免堆积（可选）
			try {
				const st = await fs_promises.stat(file_path);
				if (st.size === 0) await fs_promises.unlink(file_path);
			} catch {
				// ignore
			}
			return;
		}

		// 额外验证：确保 file_path 看起来像我们生成的日志文件名，避免将日志内容当作文件名
		try {
			const log_dir = this.file_manager.get_log_dir();
			const abs = path.resolve(file_path);
			if (!abs.startsWith(path.resolve(log_dir) + path.sep)) {
				console.error(`y8_logger: skip compressing '${file_path}' because it is outside of log_dir`);
				return;
			}
			const base = path.basename(file_path);
			// expected pattern: host_user_service_pid_yyyyMMddHHmmssSSS.log
			const filename_re = /^[\w\-]+_[\w\-]+_[\w\-]+_\d+_\d{17}\.log$/;
			if (!filename_re.test(base)) {
				console.error(`y8_logger: skip compressing '${file_path}' because filename does not match expected pattern: ${base}`);
				return;
			}
		} catch (e) {
			// 若判断过程中出错，继续但记录
			console.warn('y8_logger: warning during compress_file validation', e);
		}
		try {
			let ZipFile: any = null;
			// 先尝试动态 import；如果构建工具（例如 vite）在运行时无法解析，再尝试 createRequire
			try {
				// eslint-disable-next-line @typescript-eslint/ban-ts-comment
				// @ts-ignore
				const yazlModule = await import('yazl');
				ZipFile = (yazlModule as any).ZipFile;
			} catch (impErr) {
				// fallback: try require via createRequire
				try {
					const { createRequire } = await import('module');
					const require = createRequire(import.meta.url);
					ZipFile = require('yazl').ZipFile;
				} catch (reqErr) {
					console.error('y8_logger compress_file: failed to load yazl module via import or require', impErr, reqErr);
					return; // 无法加载 yazl，跳过压缩
				}
			}
			if (!ZipFile) {
				console.error('y8_logger compress_file: yazl ZipFile not available, skipping compression');
				return;
			}
			const zipfile = new ZipFile();
			zipfile.addFile(file_path, path.basename(file_path));
			zipfile.end();
			await new Promise<void>((resolve, reject) => {
				const outStream = fs.createWriteStream(zip_path);
				zipfile.outputStream.pipe(outStream).on('close', resolve).on('error', reject);
			});
			// 删除原始文件
			await fs_promises.unlink(file_path);
		} catch (e) {
			// 日志压缩失败时记录到控制台，但不向上抛出
			console.error("y8_logger compress_file failed:", e);
		}
	}

	/**
	 * schedule_retention_cleanup - 安排定期清理旧日志（按天），首次延迟 60s 后触发
	 * @returns void
	 */
	private schedule_retention_cleanup() {
		const ms_per_day = 24 * 60 * 60 * 1000;
		this.retention_timer = setInterval(() => {
			void this.cleanup_old_files().catch((e) => console.error("cleanup_old_files error:", e));
		}, ms_per_day);
		setTimeout(() => void this.cleanup_old_files().catch((e) => console.error("cleanup_old_files startup error:", e)), 60 * 1000);
	}

	/**
	 * cleanup_old_files - 根据 retention_days 删除旧文件（包含 .zip）
	 * @returns Promise<void> 删除完成后解析
	 */
	private async cleanup_old_files(): Promise<void> {
		const retention_days = this.config.retention_days ?? 7;
		const cutoff = Date.now() - retention_days * 24 * 60 * 60 * 1000;
		const files = await fs_promises.readdir(this.file_manager.get_log_dir());
		await Promise.all(
			files.map(async (f) => {
				try {
					const p = path.join(this.file_manager.get_log_dir(), f);
					const st = await fs_promises.stat(p);
					if (st.mtime.getTime() < cutoff) {
						await fs_promises.unlink(p);
					}
				} catch {
					// 忽略单文件删除错误
				}
			})
		);
	}

	/**
	 * write_log - 内部写日志方法：同时写入控制台（可读）与文件（JSON），并触发轮转检查
	 * @param level 日志级别（info/warn/error/debug 等）
	 * @param message 要记录的文本消息
	 * @param obj 可选对象，将连同 message 写入 JSON 文件（用于结构化日志）
	 * @returns Promise<void> 在日志写入流程完成后解析
	 */
	private async write_log(level: pino.Level | string, message: string, obj?: any): Promise<void> {
		// console pretty
		try {
			if (this.console_logger) (this.console_logger as any)[level](obj || message);
		} catch {
			// 回退到 stdout
			// eslint-disable-next-line no-console
			console.log(message, obj || "");
		}

		// file logger 写入
		// 如果 file_logger 尚未初始化完成，则等待 init_promise（避免早期写入丢失）
		if (this.init_promise) await this.init_promise;
		if (this.file_logger) {
			(this.file_logger as any)[level](obj || message);
			const approx_bytes = Buffer.byteLength(JSON.stringify(obj || message) + "\n");
			this.file_manager.increase_bytes(approx_bytes);
			await this.rotate_file_if_needed(approx_bytes);
		}
	}

	/* 公开日志方法（snake_case） */
	/**
	 * info - 记录 info 级别日志
	 * @param message 文本消息
	 * @param obj 可选对象，结构化数据
	 * @returns Promise<void> 在写入并完成轮转检查后解析
	 */
	async info(message: string, obj?: any): Promise<void> {
		await this.write_log("info", message, obj);
	}

	/**
	 * warn - 记录 warn 级别日志
	 * @param message 文本消息
	 * @param obj 可选对象，结构化数据
	 * @returns Promise<void>
	 */
	async warn(message: string, obj?: any): Promise<void> {
		await this.write_log("warn", message, obj);
	}

	/**
	 * error - 记录 error 级别日志
	 * @param message 文本消息
	 * @param obj 可选对象，结构化数据
	 * @returns Promise<void>
	 */
	async error(message: string, obj?: any): Promise<void> {
		await this.write_log("error", message, obj);
	}

	/**
	 * debug - 记录 debug 级别日志
	 * @param message 文本消息
	 * @param obj 可选对象，结构化数据
	 * @returns Promise<void>
	 */
	async debug(message: string, obj?: any): Promise<void> {
		await this.write_log("debug", message, obj);
	}

	/**
	 * update_config - 运行时更新配置（支持更改轮转阈值与保留天数）
	 * @param new_cfg 要更新的配置字段（Partial），例如 { max_size_bytes, retention_days }
	 * @returns Promise<void> 在应用配置并触发必要清理后解析
	 */
	async update_config(new_cfg: Partial<y8_logger_config>): Promise<void> {
		this.config = { ...this.config, ...new_cfg } as y8_logger_config;
		this.rotation_manager = new y8_logger_rotation_manager(this.file_manager, this.config.max_size_bytes!, this.config.rotate_daily!);
		if (new_cfg.retention_days !== undefined) {
			await this.cleanup_old_files();
		}
	}

	/**
	 * shutdown - 平滑关闭 logger
	 * @returns Promise<void> 在所有后台任务完成（尝试压缩最后一个文件）后解析
	 */
	async shutdown(): Promise<void> {
		if (this.retention_timer) clearInterval(this.retention_timer);
		const old_file_path = await this.file_manager.close_current_file_and_wait();
		if (old_file_path && this.config.compress_old) {
			await this.compress_file(old_file_path).catch(() => {});
		}
	}
}

/**
 * 导出工厂函数（风格与类方法相同，方便调用）：
 * const logger = get_y8_logger({ log_dir: 'D:/logs', service_name: 'my_service' });
 */
function get_y8_logger(config: y8_logger_config): y8_logger {
	return y8_logger.get_y8_logger(config);
}

export { y8_logger, get_y8_logger };
export default y8_logger;

