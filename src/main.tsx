import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Global error observers: log and surface unhandled runtime errors so no
// failure is silently swallowed. The React error boundary handles rendering
// crashes; these cover async rejections that escape the component tree.
window.addEventListener("error", (event) => {
  console.error("[global] unhandled error:", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("[global] unhandled rejection:", event.reason);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
