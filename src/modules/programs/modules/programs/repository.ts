import type { Program } from "../../core/types";
import type {
  ProgramRepository,
  UpdateProgramInput,
} from "./types";

export class InMemoryProgramRepository
  implements ProgramRepository
{
  private readonly programs = new Map<string, Program>();

  async create(program: Program): Promise<Program> {
    this.programs.set(program.id, program);
    return program;
  }

  async findById(id: string): Promise<Program | null> {
    return this.programs.get(id) ?? null;
  }

  async update(
    id: string,
    input: UpdateProgramInput,
  ): Promise<Program> {
    const existing = this.programs.get(id);

    if (!existing) {
      throw new Error("Program not found");
    }

    const updated: Program = {
      ...existing,
      ...input,
      updatedAt: new Date().toISOString(),
    };

    this.programs.set(id, updated);

    return updated;
  }
}