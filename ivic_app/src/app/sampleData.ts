import type { AppData } from "../types/domain";

export const sampleData: AppData = {
  groups: [],
  forms: [],
  batches: [],
  transactions: [],
  attachments: [],
  settings: {
    databasePath: "IVIC_DATA/ivic.sqlite",
    attachmentDir: "IVIC_DATA/attachments",
    darkMode: false,
    checkUpdates: false,
    hideAmounts: false,
    lastBackupAt: null,
  },
};
