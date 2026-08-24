import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type ReportTimeInterval = {
  from: string;
  to: string;
};

type ReportStoreState = {
  selectedDate: string;
  workdayInterval: ReportTimeInterval;
  selectedGroupIds: number[];
  selectedQueueIds: number[];
  selectedOperatorIds: number[];
  searchText: string;
  isFiltersCollapsed: boolean;
  isOperatorsCollapsed: boolean;
  timelineData: unknown | null;
  isTimelineBuilt: boolean;
  setSelectedDate: (value: string) => void;
  setWorkdayInterval: (value: ReportTimeInterval) => void;
  setSelectedGroupIds: (value: number[]) => void;
  setSelectedQueueIds: (value: number[]) => void;
  setSelectedOperatorIds: (value: number[]) => void;
  setSearchText: (value: string) => void;
  setIsFiltersCollapsed: (value: boolean) => void;
  setIsOperatorsCollapsed: (value: boolean) => void;
  setTimelineData: (value: unknown | null) => void;
  setIsTimelineBuilt: (value: boolean) => void;
};

function todayIsoLocal(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const useReportStore = create<ReportStoreState>()(
  persist(
    (set) => ({
      selectedDate: todayIsoLocal(),
      workdayInterval: { from: "09:00", to: "18:00" },
      selectedGroupIds: [],
      selectedQueueIds: [],
      selectedOperatorIds: [],
      searchText: "",
      isFiltersCollapsed: false,
      isOperatorsCollapsed: false,
      timelineData: null,
      isTimelineBuilt: false,
      setSelectedDate: (value) => set({ selectedDate: value }),
      setWorkdayInterval: (value) => set({ workdayInterval: value }),
      setSelectedGroupIds: (value) => set({ selectedGroupIds: value }),
      setSelectedQueueIds: (value) => set({ selectedQueueIds: value }),
      setSelectedOperatorIds: (value) => set({ selectedOperatorIds: value }),
      setSearchText: (value) => set({ searchText: value }),
      setIsFiltersCollapsed: (value) => set({ isFiltersCollapsed: value }),
      setIsOperatorsCollapsed: (value) => set({ isOperatorsCollapsed: value }),
      setTimelineData: (value) => set({ timelineData: value }),
      setIsTimelineBuilt: (value) => set({ isTimelineBuilt: value }),
    }),
    {
      name: "kit_report_state_v2",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedDate: state.selectedDate,
        workdayInterval: state.workdayInterval,
        selectedGroupIds: state.selectedGroupIds,
        selectedQueueIds: state.selectedQueueIds,
        selectedOperatorIds: state.selectedOperatorIds,
        searchText: state.searchText,
        isFiltersCollapsed: state.isFiltersCollapsed,
        isOperatorsCollapsed: state.isOperatorsCollapsed,
        timelineData: state.timelineData,
        isTimelineBuilt: state.isTimelineBuilt,
      }),
    },
  ),
);
