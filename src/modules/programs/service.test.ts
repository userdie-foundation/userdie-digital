import { ProgramService } from "./service";
import type {
  ProgramRepository,
} from "./types";

describe("ProgramService", () => {
  it("creates a program", async () => {
    const repository: ProgramRepository = {
      create: async (program) => program,
      findById: async () => null,
      update: async (_, input) => ({
        id: "test-id",
        name: input.name ?? "Test",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    };

    const service =
      new ProgramService(repository);

    const result =
      await service.createProgram({
        name: "Открытый мир",
        description: "Социальная программа фонда",
      });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.name)
        .toBe("Открытый мир");
    }
  });
});