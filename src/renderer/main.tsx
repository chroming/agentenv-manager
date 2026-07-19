import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./ui/index.css";

document.documentElement.dataset.platform = window.agentEnv.platform;

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
