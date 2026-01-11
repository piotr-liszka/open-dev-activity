export function logInfo(message: string): void {
  process.stderr.write(message + '\n');
}
