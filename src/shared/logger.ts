export class Logger {
  private prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    return `[${timestamp}] [${this.prefix}] [${level}] ${message}`;
  }

  info(message: string): void {
    console.log(this.formatMessage('INFO', message));
  }

  warn(message: string): void {
    console.warn(this.formatMessage('WARN', message));
  }

  error(message: string, error?: Error): void {
    const msg = error ? `${message}: ${error.message}` : message;
    console.error(this.formatMessage('ERROR', msg));
    if (error?.stack) {
      console.error(error.stack);
    }
  }

  success(message: string): void {
    console.log(this.formatMessage('SUCCESS', message));
  }
}
