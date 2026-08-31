import { describe, expect, it } from "vitest";
import type { Program } from "../../core/types";
import { InMemoryProgramRepository } from "./repository";

describe("InMemoryProgramRepository", () => {
  const createProgram = (): Program => ({
    id: "program-1",
    name: "Test Program",
    description: "Test description",
    status: "active",
  });

  it("creates and finds a program", async () => {
    const repository = new InMemoryProgramRepository();
    const program = createProgram();

    await repository.create(program);

    const result = await repository.findById(program.id);

    expect(result).toEqual(program);
  });

  it("updates an existing program", async () => {
    const repository = new InMemoryProgramRepository();
    const program = createProgram();

    await repository.create(program);

    const result = await repository.update(program.id, {
      name: "Updated Program",
    });

    expect(result).toEqual({
      ...program,
      name: "Updated Program",
    });
  });

  it("returns null when updating a non-existent program", async () => {
    const repository = new InMemoryProgramRepository();

    const result = await repository.update("missing-id", {
      name: "Updated Program",
    });

    expect(result).toBeNull();
  });
});