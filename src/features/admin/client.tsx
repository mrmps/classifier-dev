import { createRoot } from "react-dom/client";
import type { AdminData, RangeKey } from "../../admin";
import { Dashboard } from "./dashboard";
import "./styles.css";

const bootstrap =
  document.querySelector<HTMLScriptElement>("script[data-admin]");
const root = document.querySelector(".page");
if (bootstrap?.dataset.admin && root) {
  const props = JSON.parse(bootstrap.dataset.admin) as {
    range: RangeKey;
    data: AdminData;
  };
  createRoot(root).render(<Dashboard {...props} />);
}
