import { describe, expect, it, vi } from "vitest";
import { ProgramService } from "./service";
import type { ProgramRepository } from "./types";

function makeRepository(): ProgramRepository {
  return {
    create: vi.fn(async (program) => program),
    findById: async () => null,
    update: async () => null,
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
    const service = new ProgramService(repository);

    const result = await service.createProgram({ name: "   " });

    expect(result).toMatchObject({
      success: false,
      error: { code: "PROGRAM_NAME_REQUIRED" },
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("rejects invalid dates", async () => {
    const repository = makeRepository();
    const service = new ProgramService(repository);

    const result = await service.createProgram({
      name: "Программа",
      startDate: "не дата",
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: "PROGRAM_START_DATE_INVALID" },
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("rejects an end date earlier than the start date", async () => {
    const repository = makeRepository();
    const service = new ProgramService(repository);

    const result = await service.createProgram({
      name: "Программа",
      startDate: "2026-12-31",
      endDate: "2026-10-01",
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: "PROGRAM_DATE_RANGE_INVALID" },
    });
    expect(repository.create).not.toHaveBeenCalled();
  });
});
