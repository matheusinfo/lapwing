export const en = {
  appTitle: 'Lapwing',
  routeName: 'Route name',
  defaultRouteName: 'Running route',
  language: 'Language',

  // Theme
  theme: 'Theme',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeToggle: 'Theme: {name}. Click to change.',
  appearanceTitle: 'Appearance',
  appearanceHint: 'System follows your device setting and changes with it.',

  navToday: 'Today',
  navRoutes: 'Routes',
  navActivity: 'Analysis',
  navTraining: 'Training',
  navHistory: 'History',
  navInsights: 'Insights',
  navGear: 'Gear',
  navSettings: 'Settings',
  loadingScreen: 'Loading…',
  screenError: "Couldn't load this screen.",

  // Confirmation dialogs (src/ui/confirm.ts)
  dlgCancel: 'Cancel',
  dlgDelete: 'Delete',
  dlgReplace: 'Replace',
  dlgDisconnect: 'Disconnect',
  dlgRestore: 'Replace and restore',
  dlgDeleteRun: 'Delete run',
  dlgDeleteGoal: 'Delete goal',
  dlgDeletePlan: 'Delete plan',
  dlgDeleteWorkout: 'Delete workout',
  dlgDeleteShoe: 'Delete shoe',
  dlgReplaceSteps: 'Replace steps',
  dlgDisconnectStrava: 'Disconnect Strava',
  dlgForgetStrava: 'Forget Strava credentials',
  dlgReplaceData: 'Replace all data?',

  open: 'Open GPX',
  export: 'Export GPX',
  undo: 'Undo (Ctrl+Z)',
  redo: 'Redo (Ctrl+Y)',
  reverse: 'Reverse direction',
  closeLoop: 'Close loop (back to start)',
  clear: 'Clear route',

  distance: 'Distance',
  elevation: 'Elevation',
  time: 'Estimated time',
  pace: 'Pace',
  paceUnit: 'min/km',

  routing: 'Finding path…',
  hintEmpty: 'Click the map to start your route.',
  hintEditing:
    'Click to add points · drag to move · right-click or long-press a point to delete it · click the line to add a point in between · right-click the line to make it straight (or follow paths again).',

  routeFailed: "Couldn't find a path there, so a straight line was used.",
  gpxLoaded: 'Opened “{name}” ({distance}).',
  gpxInvalid: "This file doesn't look like a GPX file.",
  gpxEmpty: 'No track or route points found in this file.',
  gpxReadError: "Couldn't read this file.",
  nothingToExport: 'Draw a route before exporting.',
  dropHint: 'Drop a GPX file to open it',
};

export type MessageKey = keyof typeof en;
