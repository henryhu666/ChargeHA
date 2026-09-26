// One source for text the wizard and the settings page both render, so the
// two views of a control can't drift apart.

export const SUNGROW_REGIONS = [
  { value: "europe", label: "Europe" },
  { value: "international", label: "International" },
  { value: "australia", label: "Australia" },
  { value: "china", label: "China" },
  { value: "india", label: "India" },
] as const;

export const REGION_LABEL = "Server region";

export const REGION_HELP =
  "The iSolarCloud region your account belongs to. Picking the wrong one " +
  "looks exactly like a wrong password, so check this first if login fails.";
