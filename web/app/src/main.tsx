import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import "./styles/app.css";

const host = document.getElementById("root");
if (!host) throw new Error("#root is missing from index.html");

createRoot(host).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
