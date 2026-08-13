import type {
  CreateProgramInput,
  ProgramRepository,
} from "./types";

import type { Program } from "../../core/types";
import { createId } from "../../core/id";
import { ok, type Result } from "../../core/result";


export class ProgramService {
  constructor(
    private readonly repository: ProgramRepository,
  ) {}

  async createProgram(
    input: CreateProgramInput,
  ): Promise<Result<Program>> {

    const program: Program = {
      id: createId(),
      name: input.name,
      description: input.description,
      status: "active",
      startDate: input.startDate,
      endDate: input.endDate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const created =
      await this.repository.create(program);

    return ok(created);
  }
}