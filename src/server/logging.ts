import { resolveLogger, type LoggerAdapterLogger, type NormalizedLoggerAdapter } from "@package/logger-adapter";
import { PACKAGE_NAME } from "#wl6ln5sdqwob";

function socketsLog(logger?: LoggerAdapterLogger | null): NormalizedLoggerAdapter {
  return resolveLogger({
      defaultLogger: false,
      fallback: "noop",
      logger: logger || undefined,
      source: PACKAGE_NAME,
  });
}

export { socketsLog };
