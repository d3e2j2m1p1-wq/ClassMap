// Values that several modules change (an imported `let` can only be changed by the module
// that declares it, so these live on one shared object instead).
//   layoutImg            classroom photo (data URL) of the open chart
//   nextId               id counter for layout items and rules in the open chart
//   selectedItemId       selected item in the Layout tab
//   draggingItemId       item being dragged in the Layout tab
//   _canvasMouseDownTime start of a tap on the Layout background (tap = place item)
//   selectedSeatId       seated student picked by tap (Assign tab)
//   selectedStudentId    unplaced student picked by tap (Assign tab)
//   _dirty               open chart has unsaved changes
//   landingData          every class and chart: { classes: [], charts: [] }
//   activeClassId        class selected on the home page
//   activeLandingTab     home page tab: 'charts' | 'roster' | 'rules'
// Each module that owns one of these sets its starting value when it loads.
export const store = {};
