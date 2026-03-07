import { defineReactInstrument } from "tango-api";
import { PRsSidebar } from "./components/PRsSidebar.tsx";
import { PRDetailView } from "./components/PRDetailView.tsx";
import { DiffPanel } from "./components/DiffPanel.tsx";

export default defineReactInstrument({
  defaults: {
    visible: {
      sidebar: true,
      first: true,
      second: true,
      right: false,
    },
  },
  panels: {
    sidebar: PRsSidebar,
    first: PRDetailView,
    second: DiffPanel,
  },
});
