import { describe, expect, it, vi } from "vitest";
import { ProgramService } from "./service";
import type { Program } from "../../core/types";
import type { ProgramRepository } from "./types";

function makeRepository(): ProgramRepository {
  return {
    create: vi.fn(async (program) => program),
    findById: vi.fn(async () => null),
    update: vi.fn(async () => null),
  };
}

function makeExistingProgram(): Program {
  return {
    id: "program-1",
    name: "Существующая программа",
    description: "Описание",
    status: "active",
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("ProgramService", () => {
  it("creates a program and normalizes user input", async () => {
    const repository = makeRepository();
    const service = new ProgramService(repository);
    const result = await service.createProgram({
      name: "  Открытый мир  ",
      description: "  Социальная программа фонда  ",
      startDate: "2026-10-01",
      endDate: "2026-12-31",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Открытый мир");
      expect(result.data.description).toBe("Социальная программа фонда");
      expect(result.data.status).toBe("active");
      expect(result.data.id).toBeTruthy();
    }
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty program name without saving", async () => {
    const repository = makeRepository();
    const result = await new ProgramService(repository).createProgram({ name: "   " });
    expect(result).toMatchObject({ success: false, error: { code: "PROGRAM_NAME_REQUIRED" } });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("rejects invalid dates", async () => {
    const repository = makeRepository();
    const result = await new ProgramService(repository).createProgram({
      name: "Программа", startDate: "не дата",
    });
    expect(result).toMatchObject({ success: false, error: { code: "PROGRAM_START_DATE_INVALID" } });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("rejects an impossible calendar date", async () => {
    const repository = makeRepository();
    const result = await new ProgramService(repository).createProgram({
      name: "Программа", startDate: "2026-02-30",
    });
    expect(result).toMatchObject({
      success: false,
      error: { code: "PROGRAM_START_DATE_INVALID" },
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("rejects an end date earlier than the start date", async () => {
    const repository = makeRepository();
    const result = await new ProgramService(repository).createProgram({
      name: "Программа", startDate: "2026-12-31", endDate: "2026-10-01",
    });
    expect(result).toMatchObject({ success: false, error: { code: "PROGRAM_DATE_RANGE_INVALID" } });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("updates a program and normalizes supplied fields", async () => {
    const existing = makeExistingProgram();
    const repository: ProgramRepository = {
      create: vi.fn(async (program) => program),
      findById: vi.fn(async (id) => id === existing.id ? existing : null),
      update: vi.fn(async (id, input) => id === existing.id ? { ...existing, ...input } : null),
    };
    const result = await new ProgramService(repository).updateProgram(existing.id, {
      name: "  Новое название  ", description: "  Новое описание  ",
    });
    expect(result).toMatchObject({
      success: true, data: { name: "Новое название", description: "Новое описание" },
    });
    expect(repository.update).toHaveBeenCalledTimes(1);
  });

  it("rejects an update that would put the end date before the start date", async () => {
    const existing = makeExistingProgram();
    const repository: ProgramRepository = {
      create: vi.fn(async (program) => program),
      findById: vi.fn(async (id) => id === existing.id ? existing : null),
      update: vi.fn(async () => null),
    };
    const result = await new ProgramService(repository).updateProgram(existing.id, {
      endDate: "2026-09-30",
    });
    expect(result).toMatchObject({ success: false, error: { code: "PROGRAM_DATE_RANGE_INVALID" } });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("returns a not-found result when updating a missing program", async () => {
    const repository = makeRepository();
    const result = await new ProgramService(repository).updateProgram("missing", {
      name: "Новое название",
    });
    expect(result).toMatchObject({ success: false, error: { code: "PROGRAM_NOT_FOUND" } });
    expect(repository.update).not.toHaveBeenCalled();
  });
});
