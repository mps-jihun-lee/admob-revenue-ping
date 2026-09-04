import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface State {
  lastSentDate?: string;
}

export class FileStateStore {
  private state: State = {};

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      this.state = JSON.parse(await readFile(this.path, "utf8")) as State;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  wasSent(date: string): boolean {
    return this.state.lastSentDate === date;
  }

  async markSent(date: string): Promise<void> {
    this.state.lastSentDate = date;
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.path);
  }
}
