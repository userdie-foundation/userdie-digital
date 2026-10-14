import type { Program } from "../../core/types";
import { createId } from "../../core/id";
import { fail, ok, type Result } from "../../core/result";
import type { CreateProgramInput, ProgramRepository } from "./types";

export class ProgramService {
  constructor(private readonly repository: ProgramRepository) {}

  async createProgram(input: CreateProgramInput): Promise<Result<Program>> {
    const name = input.name.trim();
    if (!name) return fail("PROGRAM_NAME_REQUIRED", "Укажите название программы.");

    const startDate = input.startDate?.trim() || undefined;
    const endDate = input.endDate?.trim() || undefined;
    if (startDate && Number.isNaN(Date.parse(startDate))) {
      return fail("PROGRAM_START_DATE_INVALID", "Дата начала программы указана некорректно.");
    }
    if (endDate && Number.isNaN(Date.parse(endDate))) {
      return fail("PROGRAM_END_DATE_INVALID", "Дата окончания программы указана некорректно.");
    }
    if (startDate && endDate && Date.parse(endDate) < Date.parse(startDate)) {
      return fail("PROGRAM_DATE_RANGE_INVALID", "Дата окончания не может быть раньше даты начала.");
    }

    const now = new Date().toISOString();
    const program: Program = {
      id: createId(), name,
      description: input.description?.trim() || undefined,
      status: "active", startDate, endDate,
      createdAt: now, updatedAt: now,
    };
    const created = await this.repository.create(program);
    return ok(created);
  }
}
