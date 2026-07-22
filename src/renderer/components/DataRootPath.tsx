import { useEffect, useState } from "react";

export const DataRootPath = () => {
  const [dataRoot, setDataRoot] = useState("~/.config/agentenv-manager");
  useEffect(() => {
    let active = true;
    void window.agentEnv.readDataRoot()
      .then((path) => {
        if (active) setDataRoot(path);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return (
    <code className="settings-data-path" data-ui-overflow-detail="true" title={dataRoot}>
      {dataRoot}
    </code>
  );
};
