import { Text } from "@radix-ui/themes";
import { DiscoveryResultList } from "../../../hostUi.ts";

export interface PlantOption {
  id: string;
  name: string;
}

const pickerStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
} as const;

export function PlantPicker(
  { plants, selectedPsId, onSelect, searched }: {
    plants: PlantOption[];
    selectedPsId: string;
    onSelect: (psId: string) => void;
    searched: boolean;
  },
) {
  if (plants.length === 0 && !searched && !selectedPsId) return null;

  return (
    <div style={pickerStyle}>
      <Text as="label" size="2" weight="medium">Plant</Text>

      {plants.length === 0 && selectedPsId && (
        <Text size="1" color="gray">Current plant: {selectedPsId}</Text>
      )}

      <DiscoveryResultList
        results={plants}
        onUse={(plant: PlantOption) => onSelect(plant.id)}
        searched={searched}
        selectedId={selectedPsId}
        emptyMessage="No plants found on this iSolarCloud account."
      />
    </div>
  );
}
