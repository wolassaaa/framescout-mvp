import "@framescout/design-tokens/css";
import React from "react";
import ReactDOM from "react-dom/client";
import { RuntimeRoot } from "./RuntimeRoot";
import "./styles/app.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RuntimeRoot />
  </React.StrictMode>
);
