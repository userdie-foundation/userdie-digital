import type { Program, ID } from "../../core/types";
import { createId } from "../../core/id";
import { fail, ok, type Result } from "../../core/result";
import type {
  CreateProgramInput,
  ProgramRepository,
  UpdateProgramInput,
} from "./types";

function isValidDate(value: string): boolean {
  // Date-only values must be real calendar dates; Date.parse alone accepts
  // impossible dates such as 2026-02-30 in some JavaScript runtimes.
  const dateOnly = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day;
  }

  return !Number.isNaN(Date.parse(value));
}

function validateDateRange(
  startDate?: string,
  endDate?: string,
): Result<true> {
  if (startDate && !isValidDate(startDate)) {
    return fail("PROGRAM_START_DATE_INVALID", "Дата начала программы указана некорректно.");
  }
  if (endDate && !isValidDate(endDate)) {
    return fail("PROGRAM_END_DATE_INVALID", "Дата окончания программы указана некорректно.");
  }
  if (startDate && endDate && Date.parse(endDate) < Date.parse(startDate)) {
    return fail("PROGRAM_DATE_RANGE_INVALID", "Дата окончания не может быть раньше даты начала.");
  }
  return ok(true);
}

export class ProgramService {
  constructor(private readonly repository: ProgramRepository) {}

  async createProgram(input: CreateProgramInput): Promise<Result<Program>> {
    const name = input.name.trim();
    if (!name) return fail("PROGRAM_NAME_REQUIRED", "Укажите название программы.");

    const startDate = input.startDate?.trim() || undefined;
    const endDate = input.endDate?.trim() || undefined;
    const dates = validateDateRange(startDate, endDate);
    if (!dates.success) return dates;

    const now = new Date().toISOString();
    const program: Program = {
      id: createId(),
      name,
      description: input.description?.trim() || undefined,
      status: "active",
      startDate,
      endDate,
      createdAt: now,
      updatedAt: now,
    };
    return ok(await this.repository.create(program));
  }

  async updateProgram(
    id: ID,
    input: UpdateProgramInput,
  ): Promise<Result<Program>> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      return fail("PROGRAM_NOT_FOUND", "Программа не найдена.");
    }

    const name = input.name === undefined ? undefined : input.name.trim();
    if (name !== undefined && !name) {
      return fail("PROGRAM_NAME_REQUIRED", "Укажите название программы.");
    }

    const startDate = input.startDate === undefined
      ? existing.startDate
      : input.startDate.trim() || undefined;
    const endDate = input.endDate === undefined
      ? existing.endDate
      : input.endDate.trim() || undefined;
    const dates = validateDateRange(startDate, endDate);
    if (!dates.success) return dates;

    const normalized: UpdateProgramInput = {
      ...input,
      ...(name !== undefined ? { name } : {}),
      ...(input.description !== undefined
        ? { description: input.description.trim() || undefined }
        : {}),
      ...(input.startDate !== undefined ? { startDate } : {}),
      ...(input.endDate !== undefined ? { endDate } : {}),
    };
    const updated = await this.repository.update(id, normalized);
    if (!updated) {
      return fail("PROGRAM_NOT_FOUND", "Программа не найдена.");
    }
    return ok(updated);
  }
}
