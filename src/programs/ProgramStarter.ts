export interface ProgramStarter {
  start(program: number): Promise<void>;
}

export class ScriptProgramStarter implements ProgramStarter {
  async start(program: number): Promise<void> {
    // TODO: Execute configured script through child_process without hardcoded paths.
    void program;
  }
}
