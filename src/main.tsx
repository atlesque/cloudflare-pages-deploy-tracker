import { createRoot } from "react-dom/client";
import App from "./App";
import { prefetchDeployments } from "./lib/api";
import { readProjectPage } from "./lib/routing";
import "./styles.css";

prefetchDeployments(readProjectPage());

createRoot(document.getElementById("root")!).render(<App />);
