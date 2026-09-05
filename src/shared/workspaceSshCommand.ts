import type { RemoteDevice } from "./types";

export const quotePosixShellArgument = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

export const workspaceSshCommand = (
  device: Pick<RemoteDevice, "host" | "user" | "port">,
  path: string
) => {
  const destination = device.user ? `${device.user}@${device.host}` : device.host;
  const remoteCommand = `cd ${quotePosixShellArgument(path)} && exec "\${SHELL:-/bin/sh}" -l`;
  return [
    "ssh", ...(device.port && device.port !== 22 ? ["-p", String(device.port)] : []),
    "-t", "--", quotePosixShellArgument(destination), quotePosixShellArgument(remoteCommand)
  ].join(" ");
};
