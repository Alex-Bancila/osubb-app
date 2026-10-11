import { createContext } from 'react';
import type { LucideIcon } from 'lucide-react';

export type FabActionEntry = {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
};

export type FabRegistry = {
  upsert: (entry: FabActionEntry) => void;
  remove: (id: string) => void;
};

/** The page's `FabActions`, which a `FabAction` below it reports to. */
export const FabRegistryContext = createContext<FabRegistry | null>(null);

/** The shell's place for the plus: beside the tab bar on a phone, the content area's corner from `lg`. */
export const FabSlotContext = createContext<HTMLElement | null>(null);
