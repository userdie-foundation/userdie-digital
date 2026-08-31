import type { Program } from "../../core/types";
import { InMemoryProgramRepository } from "./repository";

describe("InMemoryProgramRepository", () => {
  const createProgram = (): Program => ({
    id: "program-1",
    title: "Test Program",
    description: "Test description",
    status: "draft",
    createdAt: "2026-08-31T10:00:00.000Z",
    updatedAt: "2026-08-31T10:00:00.000Z",
  });

  it("creates and finds a program", async () => {
    const repository = new InMemoryProgramRepository();
    const program = createProgram();

    await repository.create(program);

    await expect(repository.findById(program.id)).resolves.toEqual(program);
  });

  it("returns null when program does not exist", async () => {
    const repository = new InMemoryProgramRepository();

    await expect(repository.findById("missing")).resolves.toBeNull();
  });

  it("updates an existing program", async () => {
    const repository = new InMemoryProgramRepository();
    const program = createProgram();

    await repository.create(program);

    const updated = await repository.update(program.id, {
      title: "Updated Program",
    });

    expect(updated).not.toBeNull();
    expect(updated?.title).toBe("Updated Program");
    expect(updated?.description).toBe(program.description);
  });

  it("updates updatedAt when program is updated", async () => {
    const repository = new InMemoryProgramRepository();
    const program = createProgram();

    await repository.create(program);

    const updated = await repository.update(program.id, {
      title: "Updated Program",
    });

    expect(updated).not.toBeNull();
    expect(updated?.updatedAt).not.toBe(program.updatedAt);
  });

  it("returns null when updating a missing program", async () => {
    const repository = new InMemoryProgramRepository();

    await expect(
      repository.update("missing", {
        title: "Updated Program",
      }),
    ).resolves.toBeNull();
  });
});