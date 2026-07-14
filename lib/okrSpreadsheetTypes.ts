export type SpreadsheetSheetPayload = {
  name: string;
  rows: string[][];
};

export type SpreadsheetWorkbookPayload = {
  sheets: SpreadsheetSheetPayload[];
};
