import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type {
  CreateRemoteDeviceInput,
  RemoteDevice,
  UpdateRemoteDeviceInput
} from "../../shared/types";
import type { AgentEnvPaths } from "../paths";
import { isMissingFileError, writeAtomic } from "../fileUtils";

const RemoteDeviceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  host: z.string().min(1).max(255),
  user: z.string().min(1).max(64).optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();

const RemoteDeviceFileSchema = z.object({
  formatVersion: z.literal(1),
  devices: z.array(RemoteDeviceSchema)
}).strict();

export const parseRemoteDeviceData = (value: unknown): RemoteDevice[] =>
  RemoteDeviceFileSchema.parse(value).devices;

const HOST_PATTERN = /^(?:[A-Za-z0-9](?:[A-Za-z0-9._-]{0,253}[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])$/;
const USER_PATTERN = /^[A-Za-z0-9._-]+$/;

const normalizeInput = (input: CreateRemoteDeviceInput): CreateRemoteDeviceInput => {
  const name = input.name.trim();
  const host = input.host.trim();
  const user = input.user?.trim() || undefined;
  if (!name) throw new Error("Device name is required");
  if (!HOST_PATTERN.test(host)) {
    throw new Error("Enter an SSH host name, address, or SSH config alias");
  }
  if (user && !USER_PATTERN.test(user)) {
    throw new Error("SSH user contains unsupported characters");
  }
  if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535)) {
    throw new Error("SSH port must be between 1 and 65535");
  }
  return { name, host, ...(user ? { user } : {}), ...(input.port ? { port: input.port } : {}) };
};

export interface RemoteDeviceStore {
  list(): Promise<RemoteDevice[]>;
  get(id: string): Promise<RemoteDevice>;
  add(input: CreateRemoteDeviceInput): Promise<RemoteDevice>;
  update(input: UpdateRemoteDeviceInput): Promise<RemoteDevice>;
  remove(id: string): Promise<void>;
}

export const createRemoteDeviceStore = (paths: AgentEnvPaths): RemoteDeviceStore => {
  const read = async (): Promise<RemoteDevice[]> => {
    try {
      return parseRemoteDeviceData(JSON.parse(await readFile(paths.remoteDevicesPath, "utf8")));
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw new Error(`Remote device settings are invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const write = async (devices: RemoteDevice[]) => {
    await mkdir(dirname(paths.remoteDevicesPath), { recursive: true, mode: 0o700 });
    await writeAtomic(
      paths.remoteDevicesPath,
      `${JSON.stringify({ formatVersion: 1, devices }, null, 2)}\n`
    );
  };

  const get = async (id: string) => {
    const device = (await read()).find((candidate) => candidate.id === id);
    if (!device) throw new Error("SSH device was not found");
    return device;
  };

  return {
    list: read,
    get,
    add: async (input) => {
      const normalized = normalizeInput(input);
      const devices = await read();
      if (devices.some((device) => device.name.toLocaleLowerCase() === normalized.name.toLocaleLowerCase())) {
        throw new Error("A device with this name already exists");
      }
      const now = new Date().toISOString();
      const device: RemoteDevice = {
        id: randomUUID(),
        ...normalized,
        createdAt: now,
        updatedAt: now
      };
      await write([...devices, device]);
      return device;
    },
    update: async (input) => {
      const normalized = normalizeInput(input);
      const devices = await read();
      const index = devices.findIndex((device) => device.id === input.id);
      if (index < 0) throw new Error("SSH device was not found");
      if (devices.some((device, candidateIndex) =>
        candidateIndex !== index &&
        device.name.toLocaleLowerCase() === normalized.name.toLocaleLowerCase()
      )) {
        throw new Error("A device with this name already exists");
      }
      const device: RemoteDevice = {
        ...devices[index],
        ...normalized,
        updatedAt: new Date().toISOString()
      };
      devices[index] = device;
      await write(devices);
      return device;
    },
    remove: async (id) => {
      const devices = await read();
      const next = devices.filter((device) => device.id !== id);
      if (next.length === devices.length) throw new Error("SSH device was not found");
      await write(next);
    }
  };
};
