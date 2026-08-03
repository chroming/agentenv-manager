import { useEffect, useState } from "react";

export const useWindowChromeState = () => {
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    if (window.agentEnv.platform !== "darwin") return undefined;
    let active = true;
    void window.agentEnv.readWindowChromeState().then((state) => {
      if (active) setFullScreen(state.fullScreen);
    }).catch(() => undefined);
    const unsubscribe = window.agentEnv.onWindowChromeStateChanged((state) => {
      if (active) setFullScreen(state.fullScreen);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return fullScreen;
};
